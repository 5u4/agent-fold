import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { withSessionIndex } from "./session-index";

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

describe("withSessionIndex", () => {
  test("inserts the index right after the run boundary carrying the anchor timestamp", () => {
    const messages = [user("q1", 1), result("a"), user("q2", 2), result("b")];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q1", 1), result("a"), user("q2", 2), entry, result("b")]);
  });

  test("a later user message, such as a handoff prompt, does not move the index", () => {
    const messages = [user("q2", 2), result("a"), user("handoff", 3)];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q2", 2), entry, result("a"), user("handoff", 3)]);
  });

  test("a steering message with the anchor timestamp is not a run boundary", () => {
    const messages = [user("q2", 2), result("a"), user("steer", 2, true)];
    expect(withSessionIndex(messages, snapshot, 2)).toEqual([user("q2", 2), entry, result("a"), user("steer", 2, true)]);
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
