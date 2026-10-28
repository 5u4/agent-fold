import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { runStarts } from "./fold";

export type IndexSnapshot = { dir: string; text: string };

export const INDEX_MESSAGE_TYPE = "agent-fold.index";

export const INDEX_HEADER = "Session index `";

export function capIndex(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length <= DEFAULT_MAX_LINES && Buffer.byteLength(text) <= DEFAULT_MAX_BYTES) return text;
  let start = lines.length;
  let bytes = 0;
  while (start > 0 && lines.length - start < DEFAULT_MAX_LINES) {
    const next = bytes + Buffer.byteLength(lines[start - 1]) + 1;
    if (next > DEFAULT_MAX_BYTES) break;
    bytes = next;
    start--;
  }
  const hint = `[INDEX.md lines 1 to ${start} omitted. Read it from line 1 when you need earlier entries.]`;
  if (start === lines.length) return hint;
  return `${hint}\n${lines
    .slice(start)
    .map(line => `${line}\n`)
    .join("")}`;
}

export function withSessionIndex(messages: AgentMessage[], { dir, text }: IndexSnapshot, anchor: number): AgentMessage[] {
  let at = runStarts(messages).findLast(start => messages[start].timestamp === anchor);
  if (at === undefined) {
    at = messages.findLastIndex(
      message => message.role === "user" || message.role === "compactionSummary" || message.role === "branchSummary",
    );
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
