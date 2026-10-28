import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { isUserAuthoredMessage } from "@oh-my-pi/pi-coding-agent/session/messages";
import { runStarts } from "./fold";

export type IndexSnapshot = { dir: string; text: string };

export const INDEX_MESSAGE_TYPE = "agent-fold.index";

export const INDEX_HEADER = "Session index `";

export const INDEX_MAX_LINES = 300;

export const INDEX_MAX_BYTES = 153600;

export function capIndex(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length <= INDEX_MAX_LINES && Buffer.byteLength(text) <= INDEX_MAX_BYTES) return text;
  let kept = 0;
  let bytes = 0;
  while (kept < INDEX_MAX_LINES) {
    const next = bytes + Buffer.byteLength(lines[lines.length - 1 - kept]) + 1;
    if (next > INDEX_MAX_BYTES) break;
    bytes = next;
    kept++;
  }
  const omitted = lines.length - kept;
  const note = `[INDEX.md lines 1 to ${omitted} omitted. Read it from line 1 when you need earlier entries.]`;
  if (kept === 0) return note;
  return `${note}\n${lines
    .slice(omitted)
    .map(line => `${line}\n`)
    .join("")}`;
}

export function withSessionIndex(messages: AgentMessage[], { dir, text }: IndexSnapshot, anchor: number): AgentMessage[] {
  const starts = runStarts(messages);
  let at = starts.findLast(start => messages[start].timestamp === anchor);
  if (at === undefined) {
    at = starts.at(-1);
    if (at === undefined || isUserAuthoredMessage(messages[at])) return messages;
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
