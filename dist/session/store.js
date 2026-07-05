import Database from 'better-sqlite3';
import path from 'node:path';
import { CONFIG_DIR } from '../config/store.js';
import { createEmptyContext } from '../agent/types.js';
/** 数据库文件路径 */
const DB_PATH = path.join(CONFIG_DIR, 'sessions.db');
/** 数据库单例 */
let db = null;
/** 初始化数据库连接并建表 */
export function openDb() {
    if (db)
        return db;
    db = new Database(DB_PATH);
    // 启用 WAL 模式，支持并发读
    db.pragma('journal_mode = WAL');
    // 启用外键约束
    db.pragma('foreign_keys = ON');
    db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      phase       TEXT NOT NULL DEFAULT 'collect',
      context     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,  -- 冗余字段，方便直接 SQL 查询时按 role 筛选，恢复时以 content JSON 内的 role 为准
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      seq         INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
  `);
    return db;
}
/** 创建新会话，返回 sessionId */
export function createSession(title) {
    const database = openDb();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    database
        .prepare(`INSERT INTO sessions (id, title, phase, context, created_at, updated_at)
       VALUES (?, ?, 'collect', '{}', ?, ?)`)
        .run(id, title, now, now);
    return id;
}
/** 追加一条消息到会话 */
export function saveMessage(sessionId, role, content, seq) {
    const database = openDb();
    const now = new Date().toISOString();
    // 事务包裹确保消息 INSERT 和会话 UPDATE 的原子性
    const insertMsgAndTouchSession = database.transaction(() => {
        database
            .prepare(`INSERT INTO messages (session_id, role, content, created_at, seq)
         VALUES (?, ?, ?, ?, ?)`)
            .run(sessionId, role, content, now, seq);
        database
            .prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`)
            .run(now, sessionId);
    });
    insertMsgAndTouchSession();
}
/** 保存会话上下文和阶段 */
export function saveContext(sessionId, phase, context) {
    const database = openDb();
    const now = new Date().toISOString();
    database
        .prepare(`UPDATE sessions SET phase = ?, context = ?, updated_at = ? WHERE id = ?`)
        .run(phase, JSON.stringify(context), now, sessionId);
}
/** 查询会话列表（按 updated_at 倒序） */
export function listSessions(limit = 50) {
    const database = openDb();
    const rows = database
        .prepare(`SELECT
         s.id,
         s.title,
         s.phase,
         s.created_at AS createdAt,
         s.updated_at AS updatedAt,
         COUNT(m.id) AS messageCount
       FROM sessions s
       LEFT JOIN messages m ON m.session_id = s.id
       GROUP BY s.id
       ORDER BY s.updated_at DESC
       LIMIT ?`)
        .all(limit);
    return rows.map((row) => ({
        id: row.id,
        title: row.title,
        phase: row.phase,
        messageCount: row.messageCount,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    }));
}
/** 加载完整会话（含所有消息） */
export function loadSession(sessionId) {
    const database = openDb();
    const sessionRow = database
        .prepare(`SELECT id, title, phase, context, created_at AS createdAt, updated_at AS updatedAt
       FROM sessions WHERE id = ?`)
        .get(sessionId);
    if (!sessionRow)
        return null;
    let context;
    try {
        context = JSON.parse(sessionRow.context);
    }
    catch {
        context = createEmptyContext();
    }
    const messageRows = database
        .prepare(`SELECT role, content FROM messages
       WHERE session_id = ?
       ORDER BY seq`)
        .all(sessionId);
    const messages = messageRows.map((row) => {
        const parsed = JSON.parse(row.content);
        return { ...parsed, role: parsed.role || row.role };
    });
    return {
        id: sessionRow.id,
        title: sessionRow.title,
        phase: sessionRow.phase,
        context,
        messages,
    };
}
/** 删除会话及其所有消息（级联删除） */
export function deleteSession(sessionId) {
    const database = openDb();
    database.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}
//# sourceMappingURL=store.js.map