import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { estimateTokens, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { type CompactionDecision, decideCompaction, foldedRequestTokens } from "./compaction";
import { foldSettled } from "./fold";
import { call, reply, result, user } from "./harness/messages";

const settings = { enabled: true, reserveTokens: 1_000, keepRecentTokens: 500 };
const window = 2_000;

const cases: [string, "manual" | "threshold" | "overflow", number | undefined, CompactionDecision][] = [
  ["threshold with the folded request under the threshold", "threshold", 400, "cancel"],
  ["threshold with the folded request at the threshold", "threshold", 1_000, "cancel"],
  ["threshold with the folded request over the threshold", "threshold", 1_001, "fold-summary"],
  ["threshold with no measured request", "threshold", undefined, "fold-summary"],
  ["overflow under the threshold", "overflow", 400, "fold-summary"],
  ["manual under the threshold", "manual", 400, "fold-summary"],
];

describe("decideCompaction", () => {
  test.each(cases)("%s", (_name, reason, tokens, expected) => {
    expect(decideCompaction(reason, tokens, window, settings)).toBe(expected);
  });
});

describe("foldedRequestTokens", () => {
  const overhead = 100;
  const sentUnfolded = [user("q0", 1), call("a"), result("a", "x".repeat(40_000)), reply("done 0", 2), user("q1", 3)];
  const measured = reply("done", 5);
  const unfoldedTokens = [...sentUnfolded, measured].reduce((sum, message) => sum + estimateTokens(message), 0);
  if (measured.role !== "assistant") throw new Error("reply builds an assistant message");
  const messages: AgentMessage[] = [...sentUnfolded, { ...measured, usage: { ...measured.usage, input: unfoldedTokens + overhead } }, user("q2", 6)];
  const foldedTokens = foldSettled(messages).reduce((sum, message) => sum + estimateTokens(message), 0);
  const entry = (message: AgentMessage) => ({ type: "message", message }) as SessionEntry;
  const switchOff = { type: "custom", customType: "agent-fold.switch", data: { enabled: false } } as SessionEntry;
  const switchOn = { type: "custom", customType: "agent-fold.switch", data: { enabled: true } } as SessionEntry;

  test("a request sent while folding was off counts the tool history it carried as messages, not overhead", () => {
    const branch = [switchOff, ...messages.slice(0, 6).map(entry), switchOn, entry(messages[6])];
    expect(foldedRequestTokens(messages, branch)).toBe(overhead + foldedTokens);
  });
});
