import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { startsRun } from "./fold";

export type IndexSnapshot = { dir: string; text: string };

export const INDEX_MESSAGE_TYPE = "agent-fold.index";

export const INDEX_HEADER = "Session index `";

export function withSessionIndex(messages: AgentMessage[], { dir, text }: IndexSnapshot, anchor: number): AgentMessage[] {
  let at = messages.findLastIndex(message => startsRun(message) && message.timestamp === anchor);
  if (at === -1) {
    at = messages.findLastIndex(startsRun);
    if (at === -1 || messages[at].role === "user") return messages;
  }
  const index: AgentMessage = {
    role: "custom",
    customType: INDEX_MESSAGE_TYPE,
    content: `${INDEX_HEADER}${dir}/INDEX.md\` at the start of this run:\n\n${text.trim() === "" ? "(empty)" : text}\n\nBefore your final reply, append each location and result your reply does not spell out, as the Session index rules say.`,
    display: false,
    timestamp: messages[at].timestamp,
  };
  return [...messages.slice(0, at + 1), index, ...messages.slice(at + 1)];
}
