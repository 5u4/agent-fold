import type { LoopMessage } from "./fold";

export const INDEX_HEADER = "Session index `";

const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

export function capIndex(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length <= MAX_LINES && Buffer.byteLength(text) <= MAX_BYTES) return text;
  let kept = 0;
  let bytes = 0;
  while (kept < MAX_LINES && kept < lines.length) {
    const next = bytes + Buffer.byteLength(lines[lines.length - 1 - kept]) + 1;
    if (next > MAX_BYTES) break;
    bytes = next;
    kept++;
  }
  const hint = `[INDEX.md lines 1 to ${lines.length - kept} omitted. Read it from line 1 when you need earlier entries.]`;
  if (kept === 0) return hint;
  return `${hint}\n${lines
    .slice(lines.length - kept)
    .map(line => `${line}\n`)
    .join("")}`;
}

export function indexMessage(dir: string, text: string): LoopMessage {
  const body = text.trim() === "" ? "(empty)" : text;
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: `${INDEX_HEADER}${dir}/INDEX.md\` at the start of this run:\n\n${body}\n\nBefore your final reply, append each location and result your reply does not spell out, as the Session index rules say.`,
      },
    ],
  };
}
