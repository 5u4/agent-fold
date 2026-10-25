import { expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { foldEnabled } from "./switch";

let nextId = 0;
const base = () => ({ id: `e${nextId++}`, parentId: null, timestamp: "2026-01-01T00:00:00.000Z" });
const custom = (customType: string, data: unknown): SessionEntry => ({ type: "custom", customType, data, ...base() });
const fold = (enabled: unknown) => custom("agent-fold.switch", { enabled });
const message: SessionEntry = { type: "message", message: { role: "user", content: "hi", timestamp: 0 }, ...base() };

test("folding is on when the branch has no switch entry", () => {
  expect(foldEnabled([])).toBe(true);
  expect(foldEnabled([message])).toBe(true);
});

test("the last switch entry on the branch decides", () => {
  expect(foldEnabled([message, fold(false), message])).toBe(false);
  expect(foldEnabled([fold(false), message, fold(true)])).toBe(true);
  expect(foldEnabled([fold(true), fold(false)])).toBe(false);
});

test("malformed switch entries and other custom types are ignored", () => {
  expect(foldEnabled([fold(false), fold("on"), custom("agent-fold.switch", undefined), custom("other", { enabled: true })])).toBe(false);
  expect(foldEnabled([custom("other", { enabled: false }), custom("agent-fold.switch", null)])).toBe(true);
});
