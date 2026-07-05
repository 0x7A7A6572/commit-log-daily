import type { SessionContext, AgentPhase } from '../agent/types.js';

/** 会话列表项（不含消息体） */
export interface SessionSummary {
  id: string;
  title: string;
  phase: AgentPhase;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 完整会话（含所有消息） */
export interface FullSession {
  id: string;
  title: string;
  phase: AgentPhase;
  context: SessionContext;
  messages: StoredMessage[];
}

/** 存储的消息结构（持久化格式） */
export interface StoredMessage {
  role: 'human' | 'ai' | 'system' | 'tool';
  content: string | unknown[]; // LangChain content: string 或 ContentBlock 数组
  tool_calls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  tool_call_id?: string;
}
