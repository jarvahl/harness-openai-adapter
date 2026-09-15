import { randomUUID } from "node:crypto";
import { Type } from "typebox";

export type ChatMessage = {
  role: string;
  content?: unknown;
  tool_call_id?: string;
};

export type ChatRequest = {
  model?: string;
  messages?: ChatMessage[];
  tools?: any[];
  stream?: boolean;
};

export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content
    .filter((part: any) => part?.type === "text")
    .map((part: any) => part.text)
    .join("");
}

export function schemaFor(schema: any) {
  return Type.Unsafe(schema ?? { type: "object", properties: {} });
}

export function completion(run: { text: string }, finishReason: string, toolCalls?: any[]) {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "pi",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: run.text || null,
        ...(toolCalls?.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finishReason,
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

export function modelList() {
  return {
    object: "list",
    data: [{ id: "pi", object: "model", owned_by: "harness-openai-adapter" }],
  };
}
