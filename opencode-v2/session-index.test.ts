import { expect, test } from "bun:test";
import { capIndex } from "./session-index";

const hint = (n: number) => `[INDEX.md lines 1 to ${n} omitted. Read it from line 1 when you need earlier entries.]`;
const lines = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `L${from + i}\n`).join("");

test("an index under both limits passes through byte-identical", () => {
  const text = `${lines(1, 2000).trimEnd()}`;
  expect(capIndex(text)).toBe(text);
  expect(capIndex(lines(1, 2000))).toBe(lines(1, 2000));
});

test("past the line limit it keeps the last 2000 lines behind the omission note", () => {
  expect(capIndex(lines(1, 2001))).toBe(`${hint(1)}\n${lines(2, 2001)}`);
});

test("past the byte limit it keeps the last lines that fit in 50 KiB", () => {
  const line = "x".repeat(1023);
  const text = Array.from({ length: 60 }, (_, i) => `${i + 1}${line.slice(String(i + 1).length)}\n`).join("");
  const kept = text.split("\n").slice(10, 60).map(l => `${l}\n`).join("");
  expect(capIndex(text)).toBe(`${hint(10)}\n${kept}`);
});

test("a last line over the byte limit leaves only the note", () => {
  expect(capIndex(`a\nb\n${"x".repeat(50 * 1024)}\n`)).toBe(hint(3));
});

test("a huge first line is dropped and every later short line is kept", () => {
  expect(capIndex(`${"x".repeat(50 * 1024)}\n${lines(2, 10)}`)).toBe(`${hint(1)}\n${lines(2, 10)}`);
});
