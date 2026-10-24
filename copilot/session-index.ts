export const INDEX_MAX_LINES = 300;

export const INDEX_MAX_BYTES = 153600;

export function capIndex(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length <= INDEX_MAX_LINES && Buffer.byteLength(text) <= INDEX_MAX_BYTES) return text;
  let kept = 0;
  let bytes = 0;
  while (kept < INDEX_MAX_LINES) {
    const next = bytes + Buffer.byteLength(lines[kept]) + 1;
    if (next > INDEX_MAX_BYTES) break;
    bytes = next;
    kept++;
  }
  return `${lines
    .slice(0, kept)
    .map(line => `${line}\n`)
    .join("")}[INDEX.md continues at line ${kept + 1}. Read it from that line for the rest.]`;
}

export function indexHeading(dir: string): string {
  return `Session index \`${dir}/INDEX.md\` at the start of this run:`;
}

export function indexMessage(dir: string, text: string): string {
  return `${indexHeading(dir)}\n\n${text.trim() === "" ? "(empty)" : capIndex(text)}\n\nBefore your final reply, append each location and result your reply does not spell out, as the Session index rules say.`;
}
