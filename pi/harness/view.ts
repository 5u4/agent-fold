import type { ChatMessage, ChatRequest } from "./fake-provider";

export function text(message: ChatMessage): string {
  if (typeof message.content === "string") return message.content;
  return (message.content ?? []).flatMap(block => (block.text === undefined ? [] : [block.text])).join("");
}

export function compactRequest(request: ChatRequest): string[] {
  return request.messages.flatMap(message => {
    if (message.role === "system" || message.role === "developer") return [];
    if (message.tool_calls) return message.tool_calls.map(call => `assistant:toolCall:${call.function.name}`);
    if (message.role === "user" && text(message).startsWith("Session index `")) return ["index"];
    return [`${message.role}:${text(message)}`];
  });
}

export function systemPrompt(request: ChatRequest): string {
  return request.messages
    .filter(message => message.role === "system" || message.role === "developer")
    .map(text)
    .join("\n");
}
