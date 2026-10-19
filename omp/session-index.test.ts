import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { capIndex, withSessionIndex } from "./session-index";

const user = (text: string, timestamp: number, steering?: true): AgentMessage => ({
  role: "user",
  content: text,
  timestamp,
  ...(steering ? { steering } : {}),
});

const result = (id: string): AgentMessage => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "read",
  content: [{ type: "text", text: `result ${id}` }],
  isError: false,
  timestamp: 0,
});

const summary: AgentMessage = { role: "compactionSummary", summary: "s", tokensBefore: 0, timestamp: 9 };

const snapshot = { dir: "/f", text: "- a.ts — where? here\n" };

const injected = (body: string, timestamp: number): AgentMessage => ({
  role: "custom",
  customType: "agent-fold.index",
  content: `Session index \`/f/INDEX.md\` at the start of this run:\n\n${body}\n\nBefore your final reply, append each location and result your reply does not spell out, as the Session index rules say.`,
  display: false,
  timestamp,
});

const entry = injected("- a.ts — where? here\n", 2);

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const assistant = (
  content: Extract<AgentMessage, { role: "assistant" }>["content"],
  stopReason: "stop" | "toolUse",
  timestamp: number,
): AgentMessage => ({ role: "assistant", content, api: "openai-responses", provider: "openai", model: "m", usage, stopReason, timestamp });

const call = (id: string): AgentMessage => assistant([{ type: "toolCall", id, name: "read", arguments: {} }], "toolUse", 0);

const reply = (timestamp: number): AgentMessage => assistant([{ type: "text", text: "done" }], "stop", timestamp);

const skill = (timestamp: number): AgentMessage => ({
  role: "custom",
  customType: "skill-prompt",
  content: "SKILL BODY\n\nprobe",
  display: true,
  attribution: "user",
  timestamp,
});

describe("withSessionIndex", () => {
  test("inserts the index right after the run boundary carrying the anchor timestamp", () => {
    const messages = [user("q1", 1), result("a"), user("q2", 2), result("b")];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q1", 1), result("a"), user("q2", 2), entry, result("b")]);
  });

  test("a later user message, such as a handoff prompt, does not move the index", () => {
    const messages = [user("q2", 2), result("a"), user("handoff", 3)];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q2", 2), entry, result("a"), user("handoff", 3)]);
  });

  test("a steering message between tool calls with the anchor timestamp is not a run boundary", () => {
    const messages = [user("q2", 2), call("a"), user("steer", 2, true), result("a")];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q2", 2), entry, call("a"), user("steer", 2, true), result("a")]);
  });

  test("inserts the index right after a skill prompt that opened the first run", () => {
    const messages = [skill(2), call("a"), result("a")];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([skill(2), entry, call("a"), result("a")]);
  });

  test("inserts the index right after a skill prompt that opened a later run", () => {
    const messages = [user("q1", 1), reply(1), skill(2), call("a"), result("a")];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q1", 1), reply(1), skill(2), entry, call("a"), result("a")]);
  });

  test("returns messages unchanged when the anchor is gone and a skill prompt opened the last run", () => {
    const messages = [user("q1", 1), reply(1), skill(3)];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q1", 1), reply(1), skill(3)]);
  });

  test("when compaction summarized the anchor away, the index follows the trailing summary", () => {
    const messages = [user("q1", 1), summary, result("a")];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([
      user("q1", 1),
      summary,
      injected("- a.ts — where? here\n", 9),
      result("a"),
    ]);
  });

  test("returns messages unchanged when the anchor is gone and no summary ends the history", () => {
    const messages = [user("q1", 1), result("a"), user("q3", 3)];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q1", 1), result("a"), user("q3", 3)]);
  });

  test("returns messages unchanged without a run boundary", () => {
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

  test("keeps nothing when the first line exceeds the byte cap", () => {
    expect(capIndex(`${"x".repeat(153601)}\nshort\n`)).toBe("[INDEX.md continues at line 1. Read it from that line for the rest.]");
  });
});
