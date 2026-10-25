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
  while (kept < MAX_LINES) {
    const next = bytes + Buffer.byteLength(lines[kept]) + 1;
    if (next > MAX_BYTES) break;
    bytes = next;
    kept++;
  }
  return `${lines
    .slice(0, kept)
    .map(line => `${line}\n`)
    .join("")}[INDEX.md continues at line ${kept + 1}. Read it from that line for the rest.]`;
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
