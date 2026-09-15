import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { completion, contentText, schemaFor, type ChatMessage } from "./protocol.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export type PendingTool = {
  id: string;
  name: string;
  resolve: (result: unknown) => void;
};

export class PiRun {
  readonly tools = new Map<string, PendingTool>();
  readonly initialResponse = deferred<unknown>();
  readonly finalResponse = deferred<unknown>();
  readonly session: AgentSession;
  text = "";
  hasResponded = false;

  private constructor(session: AgentSession) {
    this.session = session;
  }

  static async start(messages: ChatMessage[], suppliedTools: any[], runtime: ModelRuntime) {
    const systemPrompt = messages
      .filter(message => message.role === "system" || message.role === "developer")
      .map(message => contentText(message.content))
      .join("\n\n");
    const userMessage = [...messages].reverse().find(message => message.role === "user");
    if (!userMessage) throw new Error("A user message is required");

    const tools = suppliedTools
      .filter(tool => tool?.type === "function" && tool.function?.name)
      .map(tool => {
        const name = tool.function.name;
        return {
          name,
          label: name,
          description: tool.function.description ?? "",
          parameters: schemaFor(tool.function.parameters),
          execute: async (id: string, _args: unknown) => new Promise(resolve => {
            run.tools.set(id, { id, name, resolve });
          }),
        };
      });

    const loader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: process.env.PI_AGENT_DIR ?? getAgentDir(),
      systemPromptOverride: () => systemPrompt || "You are a helpful assistant.",
    });
    await loader.reload();
    const { session } = await createAgentSession({
      modelRuntime: runtime,
      noTools: "all",
      tools: [],
      customTools: tools as any,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
    });
    const run = new PiRun(session);

    session.subscribe((event: any) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        run.text += event.assistantMessageEvent.delta;
      }
      if (event.type === "tool_execution_start") run.onToolCall(event);
      if (event.type === "agent_end") run.onAgentEnd();
    });

    void session.agent.prompt(contentText(userMessage.content)).catch(error => run.fail(error));
    return run;
  }

  private onToolCall(event: any) {
    const tool = this.tools.get(event.toolCallId);
    if (!tool || this.hasResponded) return;
    this.hasResponded = true;
    this.initialResponse.resolve(completion(this, "tool_calls", [{
      id: event.toolCallId,
      type: "function",
      function: { name: event.toolName, arguments: JSON.stringify(event.args) },
    }]));
  }

  private onAgentEnd() {
    const result = completion(this, "stop");
    if (!this.hasResponded) {
      this.hasResponded = true;
      this.initialResponse.resolve(result);
    }
    this.finalResponse.resolve(result);
  }

  private fail(error: unknown) {
    if (!this.hasResponded) this.initialResponse.reject(error);
    this.finalResponse.reject(error);
  }
}

export async function toolResult(run: PiRun, message: ChatMessage) {
  const id = message.tool_call_id;
  if (!id) throw new Error("tool_call_id is required");
  const tool = run.tools.get(id);
  if (!tool) throw new Error("Unknown tool_call_id");
  run.tools.delete(id);
  tool.resolve({
    content: [{ type: "text", text: contentText(message.content) }],
    details: {},
    isError: false,
  });
  return run.finalResponse.promise;
}
