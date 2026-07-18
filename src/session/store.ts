import { openDb } from './db.js';
import type { DbWrapper } from './db.js';
import type { SessionSummary, FullSession, StoredMessage } from './types.js';
import type { SessionContext, AgentPhase, SummaryMemory } from '../agent/types.js';
import { createEmptyContext } from '../agent/types.js';

/** 数据库单例 */
let db: DbWrapper | null = null;

/** 获取或初始化数据库连接并建表 */
function getOrInitDb(): DbWrapper {
  if (db) return db;

  db = openDb();

  // 建表（幂等）
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      phase       TEXT NOT NULL DEFAULT 'collect',
      context     TEXT NOT NULL,
      summary     TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      seq         INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
  `);

  // 迁移：旧数据库没有 summary 列时补充
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN summary TEXT`);
  } catch {
    // 列已存在，忽略
  }

  return db;
}

/** 创建新会话，返回 sessionId */
export function createSession(title: string): string {
  const database = getOrInitDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  database
    .prepare(
      `INSERT INTO sessions (id, title, phase, context, created_at, updated_at)
       VALUES (?, ?, 'collect', '{}', ?, ?)`,
    )
    .run(id, title, now, now);

  return id;
}

/** 追加一条消息到会话 */
export function saveMessage(
  sessionId: string,
  role: string,
  content: string,
  seq: number,
): void {
  const database = getOrInitDb();
  const now = new Date().toISOString();

  // 事务包裹确保消息 INSERT 和会话 UPDATE 的原子性
  const insertMsgAndTouchSession = database.transaction(() => {
    database
      .prepare(
        `INSERT INTO messages (session_id, role, content, created_at, seq)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionId, role, content, now, seq);

    database
      .prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`)
      .run(now, sessionId);
  });

  insertMsgAndTouchSession();
}

/** 保存会话上下文和阶段 */
export function saveContext(
  sessionId: string,
  phase: AgentPhase,
  context: SessionContext,
): void {
  const database = getOrInitDb();
  const now = new Date().toISOString();

  database
    .prepare(
      `UPDATE sessions SET phase = ?, context = ?, updated_at = ? WHERE id = ?`,
    )
    .run(phase, JSON.stringify(context), now, sessionId);
}

/** 保存摘要到会话 */
export function saveSummary(
  sessionId: string,
  summary: SummaryMemory,
): void {
  const database = getOrInitDb();
  database
    .prepare(`UPDATE sessions SET summary = ? WHERE id = ?`)
    .run(JSON.stringify(summary), sessionId);
}

/** 查询会话列表（按 updated_at 倒序） */
export function listSessions(limit = 50): SessionSummary[] {
  const database = getOrInitDb();

  const rows = database
    .prepare(
      `SELECT
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
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: string;
      title: string;
      phase: string;
      createdAt: string;
      updatedAt: string;
      messageCount: number;
    }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    phase: row.phase as AgentPhase,
    messageCount: row.messageCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** 加载完整会话（含所有消息，摘要覆盖的消息跳过加载） */
export function loadSession(sessionId: string): FullSession | null {
  const database = getOrInitDb();

  const sessionRow = database
    .prepare(
      `SELECT id, title, phase, context, summary,
              created_at AS createdAt, updated_at AS updatedAt
       FROM sessions WHERE id = ?`,
    )
    .get(sessionId) as
    | {
        id: string;
        title: string;
        phase: string;
        context: string;
        summary: string | null;
        createdAt: string;
        updatedAt: string;
      }
    | undefined;

  if (!sessionRow) return null;

  let context: SessionContext;
  try {
    const parsed = JSON.parse(sessionRow.context) as Partial<SessionContext>;
    // 合并默认值，确保新增字段（如 tokenUsage）有初始值
    context = { ...createEmptyContext(), ...parsed };
  } catch {
    context = createEmptyContext();
  }

  // 解析摘要（如果有）
  let summary: SummaryMemory | null = null;
  if (sessionRow.summary) {
    try {
      summary = JSON.parse(sessionRow.summary) as SummaryMemory;
    } catch {
      summary = null;
    }
  }

  // 加载消息，跳过摘要已覆盖的部分
  const skipUpTo = summary?.coveredUpToSeq ?? -1;
  const messageRows = database
    .prepare(
      `SELECT role, content FROM messages
       WHERE session_id = ? AND seq > ?
       ORDER BY seq`,
    )
    .all(sessionId, skipUpTo) as Array<{ role: string; content: string }>;

  const messages: StoredMessage[] = [];
  for (const row of messageRows) {
    try {
      const parsed: StoredMessage = JSON.parse(row.content) as StoredMessage;
      messages.push({ ...parsed, role: parsed.role || (row.role as StoredMessage['role']) });
    } catch {
      // 消息数据损坏时跳过，避免整个会话加载失败
      continue;
    }
  }

  return {
    id: sessionRow.id,
    title: sessionRow.title,
    phase: sessionRow.phase as AgentPhase,
    context,
    messages,
    summary,
  };
}

/** 删除会话及其所有消息（级联删除） */
export function deleteSession(sessionId: string): void {
  const database = getOrInitDb();
  database.prepare(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
}
