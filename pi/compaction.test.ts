import { describe, expect, test } from "bun:test";
import { type CompactionDecision, decideCompaction } from "./compaction";

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
