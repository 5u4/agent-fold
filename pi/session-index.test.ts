import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";
import { call, compactionSummary, reply, result, user } from "./harness/messages";
import { capIndex, withSessionIndex } from "./session-index";

const snapshot = { dir: "/f", text: "- a.ts — where? here\n" };

const injected = (body: string, timestamp: number): AgentMessage => ({
  role: "custom",
  customType: "agent-fold.index",
  content: `Session index \`/f/INDEX.md\` at the start of this run:\n\n${body}\n\nBefore your final reply, append each location and result your reply does not spell out, as the Session index rules say.`,
  display: false,
  timestamp,
});

const entry = injected("- a.ts — where? here\n", 2);

describe("withSessionIndex", () => {
  test("inserts the index right after the run start carrying the anchor timestamp", () => {
    const messages = [user("q1", 1), reply("done 1"), user("q2", 2), call("b"), result("b")];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q1", 1), reply("done 1"), user("q2", 2), entry, call("b"), result("b")]);
  });

  test("a steer with the anchor timestamp does not move the index", () => {
    const messages = [user("q2", 2), call("a"), result("a"), user("steer", 2)];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q2", 2), entry, call("a"), result("a"), user("steer", 2)]);
  });

  test("when compaction summarized the anchor away, the index follows the trailing summary", () => {
    const messages = [compactionSummary(9), call("a"), result("a")];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([
      compactionSummary(9),
      injected("- a.ts — where? here\n", 9),
      call("a"),
      result("a"),
    ]);
  });

  test("returns messages unchanged when the anchor is gone and a user message ends the history", () => {
    const messages = [compactionSummary(9), user("q3", 3)];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual(messages);
  });

  test("returns messages unchanged without a run start or summary", () => {
    expect(withSessionIndex([result("a")], snapshot, 2)).toEqual([result("a")]);
  });

  test("an empty or whitespace-only index renders as (empty)", () => {
    expect(withSessionIndex([user("q2", 2)], { dir: "/f", text: "" }, 2)).toEqual([user("q2", 2), injected("(empty)", 2)]);
    expect(withSessionIndex([user("q2", 2)], { dir: "/f", text: " \n\n" }, 2)).toEqual([user("q2", 2), injected("(empty)", 2)]);
  });

  test("does not mutate the input", () => {
    const messages = [user("q2", 2), result("a")];
    withSessionIndex(messages, snapshot, 2);
    expect(messages).toEqual([user("q2", 2), result("a")]);
  });
});

describe("capIndex follows pi's read limits", () => {
  const lines = (count: number, width = 1) => Array.from({ length: count }, (_, i) => `${i + 1}`.padEnd(width, "x"));

  test("keeps exactly the line limit unchanged", () => {
    const text = `${lines(DEFAULT_MAX_LINES).join("\n")}\n`;
    expect(capIndex(text)).toBe(text);
  });

  test("drops the first lines past the line limit", () => {
    const all = lines(DEFAULT_MAX_LINES + 1);
    expect(capIndex(`${all.join("\n")}\n`)).toBe(
      `[INDEX.md lines 1 to 1 omitted. Read it from line 1 when you need earlier entries.]\n${all.slice(1).join("\n")}\n`,
    );
  });

  test("keeps the last lines that fit the byte limit before the line limit", () => {
    const width = Math.floor(DEFAULT_MAX_BYTES / 2.5);
    const all = lines(3, width);
    expect(capIndex(all.join("\n"))).toBe(
      `[INDEX.md lines 1 to 1 omitted. Read it from line 1 when you need earlier entries.]\n${all.slice(1).join("\n")}\n`,
    );
  });

  test("keeps every short line after a huge first line", () => {
    expect(capIndex(`${"x".repeat(DEFAULT_MAX_BYTES + 1)}\na\nb\n`)).toBe(
      "[INDEX.md lines 1 to 1 omitted. Read it from line 1 when you need earlier entries.]\na\nb\n",
    );
  });

  test("keeps only the hint when the last line exceeds the byte limit", () => {
    expect(capIndex(`short\n${"x".repeat(DEFAULT_MAX_BYTES + 1)}\n`)).toBe(
      "[INDEX.md lines 1 to 2 omitted. Read it from line 1 when you need earlier entries.]",
    );
  });
});
