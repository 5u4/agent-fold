import type { Message } from "@oh-my-pi/pi-ai";
import { INDEX_HEADER } from "../session-index";

export function compactMessage(message: Message): string[] {
  switch (message.role) {
    case "user": {
      if (typeof message.content === "string") return [`user:${message.content}`];
      const texts = message.content.flatMap(block => (block.type === "text" ? [block.text] : []));
      return [`user:${texts.at(-1)}`];
    }
    case "assistant":
      return message.content.flatMap(block => {
        if (block.type === "text") return [`assistant:text:${block.text}`];
        if (block.type === "toolCall") return [`assistant:toolCall:${block.name}`];
        return [];
      });
    case "toolResult":
      return [`toolResult:${message.toolName}`];
    default:
      return [message.role];
  }
}

export function requestWithoutIndex(request: unknown): string {
  return JSON.stringify(request, (_key, value) => (typeof value === "string" && value.startsWith(INDEX_HEADER) ? undefined : value));
}
