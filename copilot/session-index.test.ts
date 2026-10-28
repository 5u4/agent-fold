import { describe, expect, test } from "bun:test";
import { capIndex, indexMessage } from "./session-index";

describe("capIndex", () => {
  const lines = (count: number, width = 1) => Array.from({ length: count }, (_, i) => `${i + 1}`.padEnd(width, "x"));

  test("keeps exactly 300 lines unchanged", () => {
    const text = `${lines(300).join("\n")}\n`;
    expect(capIndex(text)).toBe(text);
  });

  test("keeps the last 300 lines and names the omitted head", () => {
    const text = `${lines(301).join("\n")}\n`;
    expect(capIndex(text)).toBe(
      `[INDEX.md lines 1 to 1 omitted. Read it from line 1 when you need earlier entries.]\n${lines(301).slice(1).join("\n")}\n`,
    );
  });

  test("keeps the tail that fits the byte cap before the line cap", () => {
    const text = lines(3, 60000).join("\n");
    expect(capIndex(text)).toBe(
      `[INDEX.md lines 1 to 1 omitted. Read it from line 1 when you need earlier entries.]\n${lines(3, 60000).slice(1).join("\n")}\n`,
    );
  });

  test("shows only the hint when the last line alone exceeds the byte cap", () => {
    const text = `short\n${"x".repeat(153600)}\n`;
    expect(capIndex(text)).toBe("[INDEX.md lines 1 to 2 omitted. Read it from line 1 when you need earlier entries.]");
  });

  test("only the first line is huge, all later short lines are kept", () => {
    const text = `${"x".repeat(153600)}\na\nb\n`;
    expect(capIndex(text)).toBe("[INDEX.md lines 1 to 1 omitted. Read it from line 1 when you need earlier entries.]\na\nb\n");
  });
});

test("an empty index is shown as (empty)", () => {
  expect(indexMessage("/f", " \n")).toBe(
    "Session index `/f/INDEX.md` at the start of this run:\n\n(empty)\n\nBefore your final reply, append each location and result your reply does not spell out, as the Session index rules say.",
  );
});
