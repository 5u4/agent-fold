import { describe, expect, test } from "bun:test";
import { capIndex, indexMessage } from "./session-index";

describe("capIndex", () => {
  const lines = (count: number, width = 1) => Array.from({ length: count }, (_, i) => `${i + 1}`.padEnd(width, "x"));

  test("keeps exactly 300 lines unchanged", () => {
    const text = `${lines(300).join("\n")}\n`;
    expect(capIndex(text)).toBe(text);
  });

  test("cuts at the line cap and names the next line", () => {
    const text = `${lines(301).join("\n")}\n`;
    expect(capIndex(text)).toBe(`${lines(300).join("\n")}\n[INDEX.md continues at line 301. Read it from that line for the rest.]`);
  });

  test("cuts at the byte cap before the line cap", () => {
    const text = lines(3, 60000).join("\n");
    expect(capIndex(text)).toBe(`${lines(2, 60000).join("\n")}\n[INDEX.md continues at line 3. Read it from that line for the rest.]`);
  });
});

test("an empty index is shown as (empty)", () => {
  expect(indexMessage("/f", " \n")).toBe(
    "Session index `/f/INDEX.md` at the start of this run:\n\n(empty)\n\nBefore your final reply, append each location and result your reply does not spell out, as the Session index rules say.",
  );
});
