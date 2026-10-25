import { describe, expect, test } from "bun:test";
import { type CompactionDecision, decideCompaction } from "./compaction";
import { user } from "./harness/messages";

const settings = { enabled: true, reserveTokens: 1_000, keepRecentTokens: 500 };
const window = 2_000;
const sized = (tokens: number) => [user("x".repeat(tokens * 4))];

const cases: [string, "manual" | "threshold" | "overflow", number, CompactionDecision][] = [
  ["threshold with the folded view under the threshold", "threshold", 400, "cancel"],
  ["threshold with the folded view at the threshold", "threshold", 1_000, "cancel"],
  ["threshold with the folded view over the threshold", "threshold", 1_001, "fold-summary"],
  ["overflow under the threshold", "overflow", 400, "fold-summary"],
  ["manual under the threshold", "manual", 400, "fold-summary"],
];

describe("decideCompaction", () => {
  test.each(cases)("%s", (_name, reason, tokens, expected) => {
    expect(decideCompaction(reason, sized(tokens), window, settings)).toBe(expected);
  });
});
