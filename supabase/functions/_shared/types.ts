export type ToolStepStatus = "pending" | "running" | "done" | "error";

export interface ToolStep {
  id: string;
  tool: string;
  label: string;
  status: ToolStepStatus;
  args?: Record<string, unknown>;
  resultPreview?: string;
  reasoning?: string;
  meta?: {
    requestId?: string;
    priceCents?: number;
    durationMs?: number;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

export interface SseEvent {
  type:
    | "token"
    | "tool_start"
    | "tool_done"
    | "thinking"
    | "reasoning"
    | "reasoning_delta"
    | "done"
    | "error"
    | "conversation"
    | "title";
  content?: string;
  id?: string;
  tool?: string;
  label?: string;
  args?: Record<string, unknown>;
  success?: boolean;
  meta?: ToolStep["meta"];
  resultPreview?: string;
  contextTokens?: number;
  contextLimit?: number;
  conversationId?: string;
  title?: string;
  message?: string;
  /** Live agent narrative (`agent`) or post-tool synthesis notes (`after_tools`). */
  placement?: "agent" | "after_tools";
  stepId?: string;
  reasoningBefore?: string;
  reasoningAfter?: string;
}

export interface ChatAttachment {
  path: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface ChatRequest {
  conversationId?: string;
  message: string;
  stream?: boolean;
  model?: string;
  attachments?: ChatAttachment[];
}
