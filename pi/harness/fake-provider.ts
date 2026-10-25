export type Reply = ({ text: string } | { toolCall: { name: string; arguments: Record<string, unknown> } }) & { inputTokens?: number };

export type QueuedReply = Reply | ((request: ChatRequest) => Reply);

export type ChatMessage = {
  role: string;
  content?: string | { type: string; text?: string }[] | null;
  tool_calls?: { function: { name: string } }[];
};

export type ChatRequest = { model: string; messages: ChatMessage[] };

export type FakeProvider = {
  baseUrl: string;
  requests: ChatRequest[];
  enqueue(...replies: QueuedReply[]): void;
  stop(): void;
};

function chunk(delta: Record<string, unknown>, finishReason: string | null, usage?: Record<string, number>): string {
  const body = {
    id: "fake",
    object: "chat.completion.chunk",
    created: 0,
    model: "fake",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    usage,
  };
  return `data: ${JSON.stringify(body)}\n\n`;
}

function sse(reply: Reply, call: number): string {
  const input = reply.inputTokens ?? 1;
  const usage = { prompt_tokens: input, completion_tokens: 1, total_tokens: input + 1 };
  if ("text" in reply) return `${chunk({ role: "assistant", content: reply.text }, null)}${chunk({}, "stop", usage)}data: [DONE]\n\n`;
  const toolCall = {
    index: 0,
    id: `call_${call}`,
    type: "function",
    function: { name: reply.toolCall.name, arguments: JSON.stringify(reply.toolCall.arguments) },
  };
  return `${chunk({ role: "assistant", tool_calls: [toolCall] }, null)}${chunk({}, "tool_calls", usage)}data: [DONE]\n\n`;
}

export function startFakeProvider(): FakeProvider {
  const queue: QueuedReply[] = [];
  const requests: ChatRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = (await request.json()) as ChatRequest;
      requests.push(body);
      const next = queue.shift();
      if (!next) return new Response(`no scripted reply for request ${requests.length}`, { status: 500 });
      let reply: Reply;
      try {
        reply = typeof next === "function" ? next(body) : next;
      } catch (error) {
        return new Response(String(error), { status: 500 });
      }
      return new Response(sse(reply, requests.length), { headers: { "content-type": "text/event-stream" } });
    },
  });
  return {
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
    requests,
    enqueue: (...replies) => queue.push(...replies),
    stop: () => server.stop(true),
  };
}
