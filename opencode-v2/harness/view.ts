import { CHECKPOINT_PREFIX, type ChatRequest, INDEX_PREFIX, text } from "./fake-provider";

export function compactRequest(request: ChatRequest): string[] {
  return request.messages.flatMap(message => {
    if (message.role === "system") return [];
    const body = text(message).replace(/^"|"$/g, "");
    if (message.role === "user" && body.startsWith(INDEX_PREFIX)) return ["index"];
    if (message.role === "user" && body.startsWith(CHECKPOINT_PREFIX)) return ["checkpoint"];
    const calls = (message.tool_calls ?? []).map(call => `assistant:toolCall:${call.function.name}`);
    if (message.role === "tool") return ["tool"];
    return body === "" ? calls : [`${message.role}:${body}`, ...calls];
  });
}

export function systemPrompt(request: ChatRequest): string {
  return request.messages
    .filter(message => message.role === "system")
    .map(text)
    .join("\n");
}
