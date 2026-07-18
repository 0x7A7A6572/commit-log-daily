import { BaseCheckpointSaver } from '@langchain/langgraph';
import type {
  Checkpoint,
  CheckpointTuple,
  CheckpointMetadata,
} from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import { getOrInitDb } from '../session/store.js';
import type { DbWrapper } from '../session/db.js';

/** 检查点列表查询选项（类型来自 @langchain/langgraph-checkpoint） */
interface CheckpointListOptions {
  limit?: number;
  before?: RunnableConfig;
  filter?: Record<string, unknown>;
}

/** 待写入通道更新元组（类型来自 @langchain/langgraph-checkpoint） */
type PendingWrite = [channel: string, value: unknown];

/**
 * 从 RUN_TIME config 中提取 checkpoint_id
 * 与 @langchain/langgraph-checkpoint 中的实现保持一致
 */
function getCheckpointId(config: RunnableConfig): string {
  return (config.configurable?.checkpoint_id as string) ?? '';
}

/**
 * 写入索引映射：特殊通道使用负索引，避免与普通写入冲突
 * 与 @langchain/langgraph-checkpoint 中的 WRITES_IDX_MAP 保持一致
 */
const WRITES_IDX_MAP: Record<string, number> = {
  __error__: -1,
  __scheduled__: -2,
  __interrupt__: -3,
  __resume__: -4,
};

/**
 * 深拷贝 Checkpoint，防止外部修改影响已存储数据
 * 与 @langchain/langgraph-checkpoint 中的 copyCheckpoint 保持一致
 */
function copyCheckpoint(checkpoint: Checkpoint): Checkpoint {
  return {
    v: checkpoint.v,
    id: checkpoint.id,
    ts: checkpoint.ts,
    channel_values: { ...checkpoint.channel_values },
    channel_versions: { ...checkpoint.channel_versions },
    versions_seen: Object.fromEntries(
      Object.entries(checkpoint.versions_seen ?? {}).map(([k, v]) => [k, { ...v }]),
    ),
  };
}

/** 原型污染防护：禁止用作存储键的字符串 */
const POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertSafeStorageKey(field: string, value: string, allowEmpty = false): void {
  if (typeof value !== 'string') {
    const observed =
      value === null ? 'null' : value === undefined ? 'undefined' : Array.isArray(value) ? 'array' : typeof value;
    throw new Error(
      `Invalid configurable value for key "${field}": expected a string identifier (got ${observed}).`,
    );
  }
  if (!allowEmpty && value === '') {
    throw new Error(
      `Invalid configurable value for key "${field}": empty string is not permitted as a storage key.`,
    );
  }
  if (POLLUTION_KEYS.has(value)) {
    throw new Error(
      `Invalid configurable value for key "${field}": value "${value}" is reserved (would mutate Object.prototype).`,
    );
  }
}

/** 单条检查点行（从 SQLite 查询得到） */
interface CheckpointRow {
  checkpoint_id: string;
  checkpoint: Uint8Array;
  metadata: Uint8Array;
  parent_checkpoint_id: string | null;
}

/** 单条写入行 */
interface WriteRow {
  task_id: string;
  channel: string;
  value: Uint8Array;
}

/**
 * 基于 sql.js (SQLite WASM) 的 LangGraph CheckpointSaver
 *
 * 复用项目已有的 sessions.db，将检查点和待写入数据持久化到 SQLite。
 * 进程重启后中断/恢复状态不丢失。
 */
export class SqliteSaver extends BaseCheckpointSaver {
  private _db: DbWrapper | null = null;

  /** 延迟获取数据库实例：首次 Graph 操作时才调用 getOrInitDb()，此时 initDb 已完成 */
  private get db(): DbWrapper {
    if (!this._db) {
      this._db = getOrInitDb();
    }
    return this._db;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = (config.configurable?.thread_id as string) ?? '';
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? '';
    let checkpointId = getCheckpointId(config);

    if (threadId) assertSafeStorageKey('thread_id', threadId);
    assertSafeStorageKey('checkpoint_ns', checkpointNs, true);

    if (checkpointId) {
      assertSafeStorageKey('checkpoint_id', checkpointId);
      const row = this.db
        .prepare(
          `SELECT checkpoint_id, checkpoint, metadata, parent_checkpoint_id
           FROM checkpoints
           WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
        )
        .get(threadId, checkpointNs, checkpointId) as CheckpointRow | undefined;

      if (row) {
        return this._buildTuple(row, threadId, checkpointNs, config);
      }
    } else {
      // 未指定 checkpoint_id：取最新（按 ID 降序，UUID v6 天然有序）
      const row = this.db
        .prepare(
          `SELECT checkpoint_id, checkpoint, metadata, parent_checkpoint_id
           FROM checkpoints
           WHERE thread_id = ? AND checkpoint_ns = ?
           ORDER BY checkpoint_id DESC LIMIT 1`,
        )
        .get(threadId, checkpointNs) as CheckpointRow | undefined;

      if (row) {
        checkpointId = row.checkpoint_id;
        return this._buildTuple(row, threadId, checkpointNs, {
          configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpointId },
        });
      }
    }
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    let { before, limit, filter } = options ?? {};

    const threadId = (config.configurable?.thread_id as string) ?? '';
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? '';
    const configCheckpointId = config.configurable?.checkpoint_id as string | undefined;

    if (threadId) assertSafeStorageKey('thread_id', threadId);
    if (checkpointNs) assertSafeStorageKey('checkpoint_ns', checkpointNs, true);
    if (configCheckpointId) assertSafeStorageKey('checkpoint_id', configCheckpointId);
    if (before?.configurable?.checkpoint_id)
      assertSafeStorageKey('checkpoint_id', before.configurable.checkpoint_id as string);

    // 构建查询条件
    const conditions: string[] = [];
    const params: Array<string | number | Uint8Array | null> = [];

    if (threadId) {
      conditions.push('thread_id = ?');
      params.push(threadId);
    }
    if (checkpointNs) {
      conditions.push('checkpoint_ns = ?');
      params.push(checkpointNs);
    }
    if (configCheckpointId) {
      conditions.push('checkpoint_id = ?');
      params.push(configCheckpointId);
    }
    if (before?.configurable?.checkpoint_id) {
      conditions.push('checkpoint_id < ?');
      params.push(before.configurable.checkpoint_id as string);
    }
    if (limit !== undefined) {
      // +1 用于检测是否会被 filter 缩减到 <= limit
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitClause = limit !== undefined ? `LIMIT ${limit}` : '';

    const rows = this.db
      .prepare(
        `SELECT checkpoint_id, checkpoint, metadata, parent_checkpoint_id
         FROM checkpoints ${where}
         ORDER BY checkpoint_id DESC ${limitClause}`,
      )
      .all(...params) as CheckpointRow[];

    for (const row of rows) {
      // metadata 过滤（在 JS 侧执行，SQLite 无法直接过滤 JSON）
      if (filter) {
        const meta = (await this.serde.loadsTyped('json', row.metadata)) as Record<string, unknown>;
        if (!Object.entries(filter).every(([key, value]) => meta[key] === value)) {
          continue;
        }
      }

      if (limit !== undefined) {
        if (limit <= 0) break;
        limit -= 1;
      }

      yield await this._buildTuple(
        row,
        threadId,
        checkpointNs,
        {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: row.checkpoint_id,
          },
        },
      );
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: Record<string, string | number>,
  ): Promise<RunnableConfig> {
    const preparedCheckpoint = copyCheckpoint(checkpoint);
    const threadId = (config.configurable?.thread_id as string) ?? '';
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? '';

    if (!threadId) {
      throw new Error(
        'Failed to put checkpoint. The passed RunnableConfig is missing a required "thread_id" field.',
      );
    }

    assertSafeStorageKey('thread_id', threadId);
    assertSafeStorageKey('checkpoint_ns', checkpointNs, true);
    assertSafeStorageKey('checkpoint_id', checkpoint.id);

    const [[, serializedCheckpoint], [, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(preparedCheckpoint),
      this.serde.dumpsTyped(metadata),
    ]);

    const parentId = (config.configurable?.checkpoint_id as string) ?? null;
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints
         (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(threadId, checkpointNs, checkpoint.id, parentId, serializedCheckpoint, serializedMetadata, now);

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = (config.configurable?.thread_id as string) ?? '';
    const checkpointNs = (config.configurable?.checkpoint_ns as string) ?? '';
    const checkpointId = (config.configurable?.checkpoint_id as string) ?? '';

    if (!threadId) {
      throw new Error(
        'Failed to put writes. The passed RunnableConfig is missing a required "thread_id" field.',
      );
    }
    if (!checkpointId) {
      throw new Error(
        'Failed to put writes. The passed RunnableConfig is missing a required "checkpoint_id" field.',
      );
    }

    assertSafeStorageKey('thread_id', threadId);
    assertSafeStorageKey('checkpoint_ns', checkpointNs, true);
    assertSafeStorageKey('checkpoint_id', checkpointId);
    assertSafeStorageKey('task_id', taskId);

    // 批量检查已有的 writes（跳过已存在的正常写入）
    const existing = new Set<string>();
    const existingRows = this.db
      .prepare(
        `SELECT task_id, idx FROM checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
      )
      .all(threadId, checkpointNs, checkpointId) as Array<{ task_id: string; idx: number }>;

    for (const r of existingRows) {
      existing.add(`${r.task_id},${r.idx}`);
    }

    // 串行序列化并插入，sql.js 不支持并发操作
    for (let idx = 0; idx < writes.length; idx++) {
      const [channel, value] = writes[idx]!;
      const mappedIdx = WRITES_IDX_MAP[channel] !== undefined ? WRITES_IDX_MAP[channel]! : idx;

      // 已存在的正常写入跳过（特殊通道 WRITES_IDX_MAP 值可能为负，不跳过）
      const key = `${taskId},${mappedIdx}`;

      if (mappedIdx >= 0 && existing.has(key)) continue;

      const [, serializedValue] = await this.serde.dumpsTyped(value);

      this.db
        .prepare(
          `INSERT OR REPLACE INTO checkpoint_writes
           (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(threadId, checkpointNs, checkpointId, taskId, mappedIdx, channel, serializedValue);

      existing.add(key);
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    assertSafeStorageKey('thread_id', threadId);

    this.db.prepare(`DELETE FROM checkpoints WHERE thread_id = ?`).run(threadId);
    this.db.prepare(`DELETE FROM checkpoint_writes WHERE thread_id = ?`).run(threadId);
  }

  /** 从行数据构建 CheckpointTuple */
  private async _buildTuple(
    row: CheckpointRow,
    threadId: string,
    checkpointNs: string,
    config: RunnableConfig,
  ): Promise<CheckpointTuple> {
    const deserializedCheckpoint = (await this.serde.loadsTyped('json', row.checkpoint)) as Checkpoint;
    const deserializedMetadata = (await this.serde.loadsTyped('json', row.metadata)) as CheckpointMetadata;

    // 查询 pending writes
    const writeRows = this.db
      .prepare(
        `SELECT task_id, channel, value FROM checkpoint_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id, idx`,
      )
      .all(threadId, checkpointNs, row.checkpoint_id) as WriteRow[];

    const pendingWrites = await Promise.all(
      writeRows.map(async (w) => {
        return [
          w.task_id,
          w.channel,
          await this.serde.loadsTyped('json', w.value),
        ] as [string, string, unknown];
      }),
    );

    const tuple: CheckpointTuple = {
      config,
      checkpoint: deserializedCheckpoint,
      metadata: deserializedMetadata,
      pendingWrites,
    };

    if (row.parent_checkpoint_id) {
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.parent_checkpoint_id,
        },
      };
    }

    return tuple;
  }
}

/** 创建 SqliteSaver 实例的工厂函数 */
export function createSqliteSaver(): SqliteSaver {
  return new SqliteSaver();
}
