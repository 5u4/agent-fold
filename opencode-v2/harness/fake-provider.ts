import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ChatMessage = {
  role: string;
  content?: string | { type: string; text?: string }[] | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
};

export type ChatRequest = { messages: ChatMessage[]; tools?: { function: { name: string } }[] };

export type RequestKind = "agent" | "title" | "compaction";

export type FakeProvider = {
  baseUrl: string;
  requests: ChatRequest[];
  agentRequests(): ChatRequest[];
  lastAgentRequest(): ChatRequest;
  received(prompt: string): Promise<void>;
  releaseHeld(): void;
  toolStarted(gate: string): Promise<void>;
  releaseTool(gate: string): void;
  stop(): void;
};

export const CHECKPOINT_PREFIX = "<conversation-checkpoint>";
export const INDEX_PREFIX = "Session index `";

const SUMMARY = [
  "## Objective",
  "- fake summary",
  "## Requirements",
  "- (none)",
  "## Decisions",
  "- (none)",
  "## Work State",
  "### Completed",
  "- (none)",
  "### Active",
  "- (none)",
  "### Blocked",
  "- (none)",
  "## Next Move",
  "1. (none)",
  "## Relevant Files",
  "- (none)",
  "## Important Context",
  "- (none)",
].join("\n");

export function text(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return (message.content ?? []).flatMap(part => (part.text === undefined ? [] : [part.text])).join("");
}

export function requestKind(request: ChatRequest): RequestKind {
  const last = request.messages.at(-1);
  const lastText = last ? text(last) : "";
  if (lastText.includes("<template>") || lastText.includes("did not fill in the required summary template")) return "compaction";
  return (request.tools ?? []).length === 0 ? "title" : "agent";
}

export function promptOf(request: ChatRequest): string {
  const prompt = request.messages.findLast(
    message => message.role === "user" && !text(message).startsWith(CHECKPOINT_PREFIX) && !text(message).startsWith(INDEX_PREFIX),
  );
  return prompt ? text(prompt).replace(/^"|"$/g, "") : "";
}

function frame(body: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ id: "fake", object: "chat.completion.chunk", created: 0, model: "m", ...body })}\n\n`;
}

function stream(delta: Record<string, unknown>, finishReason: string, promptTokens: number): Response {
  const body = [
    frame({ choices: [{ index: 0, delta, finish_reason: null }] }),
    frame({ choices: [{ index: 0, delta: {}, finish_reason: finishReason }] }),
    frame({ choices: [], usage: { prompt_tokens: promptTokens, completion_tokens: 1, total_tokens: promptTokens + 1 } }),
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

export function startFakeProvider({ toolPath, signalDir }: { toolPath: string; signalDir: string }): FakeProvider {
  const requests: ChatRequest[] = [];
  const watchers: { prompt: string; resolve: () => void }[] = [];
  let held: (() => void)[] = [];

  function reply(request: ChatRequest, call: number): Response | Promise<Response> {
    const kind = requestKind(request);
    if (kind === "compaction") return stream({ role: "assistant", content: SUMMARY }, "stop", 10);
    if (kind === "title") return stream({ role: "assistant", content: "fake title" }, "stop", 10);
    const prompt = promptOf(request);
    const tokens = prompt.includes("BIG") ? 19_900 : 10;
    const say = (content: string) => stream({ role: "assistant", content }, "stop", tokens);
    const callTool = (name: string, args: Record<string, unknown>) =>
      stream(
        {
          role: "assistant",
          tool_calls: [{ index: 0, id: `call_${call}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
        },
        "tool_calls",
        tokens,
      );
    if (request.messages.at(-1)?.role === "tool") return say(`after tool: ${prompt}`);
    if (prompt.includes("FAIL"))
      return Response.json({ error: { message: "fake failure", type: "invalid_request_error" } }, { status: 400 });
    if (prompt.includes("HOLD")) {
      const { promise, resolve } = Promise.withResolvers<Response>();
      held.push(() => resolve(say(`held reply: ${prompt}`)));
      return promise;
    }
    const gate = prompt.match(/CALLWAIT:(\w+)/)?.[1];
    if (gate) {
      const started = join(signalDir, `${gate}.started`);
      const release = join(signalDir, `${gate}.release`);
      return callTool("shell", {
        command: `touch '${started}'; until [ -f '${release}' ]; do sleep 0.05; done`,
        description: "wait for the test",
      });
    }
    if (prompt.includes("CALLREAD")) return callTool("read", { path: toolPath });
    return say(`reply: ${prompt}`);
  }

  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(incoming) {
      if (new URL(incoming.url).pathname.endsWith("/models")) return Response.json({ data: [{ id: "m", object: "model" }] });
      const request = (await incoming.json()) as ChatRequest;
      requests.push(request);
      const prompt = promptOf(request);
      for (const watcher of watchers.filter(watcher => requestKind(request) === "agent" && prompt === watcher.prompt)) {
        watchers.splice(watchers.indexOf(watcher), 1);
        watcher.resolve();
      }
      return reply(request, requests.length);
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    agentRequests: () => requests.filter(request => requestKind(request) === "agent"),
    lastAgentRequest() {
      const last = requests.findLast(request => requestKind(request) === "agent");
      if (!last) throw new Error("the provider received no agent request");
      return last;
    },
    received(prompt) {
      if (requests.some(request => requestKind(request) === "agent" && promptOf(request) === prompt)) return Promise.resolve();
      const { promise, resolve } = Promise.withResolvers<void>();
      watchers.push({ prompt, resolve });
      return promise;
    },
    releaseHeld() {
      for (const release of held) release();
      held = [];
    },
    async toolStarted(gate) {
      const started = join(signalDir, `${gate}.started`);
      while (!existsSync(started)) await Bun.sleep(50);
    },
    releaseTool(gate) {
      writeFileSync(join(signalDir, `${gate}.release`), "");
    },
    stop: () => server.stop(true),
  };
}
