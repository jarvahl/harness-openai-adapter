import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiRun, toolResult } from "./pi.js";
import { modelList, type ChatRequest, type ChatMessage } from "./protocol.js";

const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY_BYTES = 2_000_000;

const runsByToolCall = new Map<string, PiRun>();
let modelRuntime: ModelRuntime | undefined;

async function getModelRuntime() {
  return modelRuntime ??= await ModelRuntime.create({ allowModelNetwork: false });
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function sendError(res: ServerResponse, status: number, message: string, type = "invalid_request_error") {
  sendJson(res, status, { error: { message, type } });
}

async function readJson(req: IncomingMessage): Promise<ChatRequest> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function sendCompletion(res: ServerResponse, value: any, stream: boolean) {
  if (!stream) return sendJson(res, 200, value);

  const choice = value.choices[0];
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({
    ...value,
    object: "chat.completion.chunk",
    choices: [{
      index: 0,
      delta: { role: "assistant", content: choice.message.content },
      finish_reason: choice.finish_reason,
    }],
  })}\n\n`);
  res.end("data: [DONE]\n\n");
}

function lastToolMessage(messages: ChatMessage[]) {
  return [...messages].reverse().find(message => message.role === "tool" && message.tool_call_id);
}

async function chatCompletion(req: IncomingMessage, res: ServerResponse, input: ChatRequest) {
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    return sendError(res, 400, "messages must be a non-empty array");
  }
  if (!input.model) return sendError(res, 400, "model is required");
  const runtime = await getModelRuntime();
  const selectedModel = runtime.getAvailableSnapshot().find(
    model => `${model.provider}/${model.id}` === input.model,
  );
  if (!selectedModel) return sendError(res, 400, "Unknown or unavailable model");

  const toolMessage = lastToolMessage(input.messages);
  if (toolMessage) {
    if (!runsByToolCall.has(toolMessage.tool_call_id!)) {
      return sendError(res, 409, "Unknown tool_call_id");
    }
    const run = runsByToolCall.get(toolMessage.tool_call_id!)!;
    runsByToolCall.delete(toolMessage.tool_call_id!);
    const result = await toolResult(run, toolMessage);
    return sendCompletion(res, result, input.stream === true);
  }

  const run = await PiRun.start(input.messages, input.tools ?? [], runtime, selectedModel);

  req.on("close", () => {
    if (!res.writableEnded) void run.session.abort();
  });

  const result = await run.initialResponse.promise;
  for (const id of run.tools.keys()) runsByToolCall.set(id, run);
  return sendCompletion(res, result, input.stream === true);
}

const server = createServer(async (req, res) => {
  const requestId = randomUUID();
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { status: "ok" });
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      return sendJson(res, 200, modelList((await getModelRuntime()).getAvailableSnapshot()));
    }
    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      return await chatCompletion(req, res, await readJson(req));
    }
    return sendError(res, 404, "Not found", "not_found_error");
  } catch (error: any) {
    console.error(`[${requestId}] ${error?.message ?? error}`);
    if (!res.headersSent) sendError(res, 500, "Pi request failed", "server_error");
    else res.destroy();
  }
});

server.listen(PORT, HOST, () => {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : PORT;
  console.log(`harness-openai-adapter listening on http://${HOST}:${port}`);
});
