export const INDEX_MAX_LINES = 300;

export const INDEX_MAX_BYTES = 153600;

export function capIndex(text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length <= INDEX_MAX_LINES && Buffer.byteLength(text) <= INDEX_MAX_BYTES) return text;
  let start = lines.length;
  let bytes = 0;
  while (lines.length - start < INDEX_MAX_LINES && start > 0) {
    const next = bytes + Buffer.byteLength(lines[start - 1]) + 1;
    if (next > INDEX_MAX_BYTES) break;
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

export function indexHeading(dir: string): string {
  return `Session index \`${dir}/INDEX.md\` at the start of this run:`;
}

export function indexMessage(dir: string, text: string): string {
  return `${indexHeading(dir)}\n\n${text.trim() === "" ? "(empty)" : capIndex(text)}\n\nBefore your final reply, append each location and result your reply does not spell out, as the Session index rules say.`;
}
