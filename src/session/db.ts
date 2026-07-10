import initSqlJs, { type Database as SqlJsDb, type BindParams } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';

type SqlParam = string | number | null;

let database: SqlJsDb | null = null;
let dbPath: string = '';
/** 事务嵌套深度——事务内的写操作延迟 save，仅在 COMMIT 后一次性持久化 */
let transactionDepth = 0;

/** 初始化 sql.js 数据库，从磁盘加载或创建新库 */
export async function initDb(filePath: string): Promise<void> {
  const SQL = await initSqlJs();

  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  if (fs.existsSync(filePath)) {
    const buffer = fs.readFileSync(filePath);
    database = new SQL.Database(buffer);
  } else {
    database = new SQL.Database();
  }

  dbPath = filePath;

  // 启用外键约束
  database.run('PRAGMA foreign_keys = ON');
}

/** 持久化数据库到磁盘 */
function save(): void {
  if (!database) return;
  const data = database.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

/** Prepared Statement 包装，模拟 better-sqlite3 API */
export interface StatementWrapper {
  run(...params: SqlParam[]): void;
  get<T = Record<string, unknown>>(...params: SqlParam[]): T | undefined;
  all<T = Record<string, unknown>>(...params: SqlParam[]): T[];
}

/** 数据库包装，模拟 better-sqlite3 API */
export interface DbWrapper {
  pragma(sql: string): void;
  exec(sql: string): void;
  prepare(sql: string): StatementWrapper;
  transaction<T extends (...args: unknown[]) => void>(fn: T): T;
}

/** 获取已初始化的数据库包装实例（同步，要求 initDb 已完成） */
export function openDb(): DbWrapper {
  const db = database;
  if (!db) throw new Error('Database not initialized. Call initDb() first.');

  return {
    pragma(sql: string): void {
      db.run(`PRAGMA ${sql}`);
    },

    exec(sql: string): void {
      db.run(sql);
      save();
    },

    prepare(sql: string): StatementWrapper {
      return {
        run(...params: SqlParam[]): void {
          const stmt = db.prepare(sql);
          stmt.bind(params as BindParams);
          stmt.step();
          stmt.free();
          if (transactionDepth === 0) save();
        },

        get<T = Record<string, unknown>>(...params: SqlParam[]): T | undefined {
          const stmt = db.prepare(sql);
          stmt.bind(params as BindParams);
          let result: T | undefined;
          if (stmt.step()) {
            result = stmt.getAsObject() as unknown as T;
          }
          stmt.free();
          return result;
        },

        all<T = Record<string, unknown>>(...params: SqlParam[]): T[] {
          const stmt = db.prepare(sql);
          stmt.bind(params as BindParams);
          const results: T[] = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject() as unknown as T);
          }
          stmt.free();
          return results;
        },
      };
    },

    transaction<T extends (...args: unknown[]) => void>(fn: T): T {
      return ((...args: unknown[]) => {
        transactionDepth++;
        db.run('BEGIN TRANSACTION');
        try {
          fn(...args);
          db.run('COMMIT');
          save();
        } catch (e) {
          db.run('ROLLBACK');
          throw e;
        } finally {
          transactionDepth--;
        }
      }) as unknown as T;
    },
  };
}
