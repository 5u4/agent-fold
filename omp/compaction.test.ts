import { describe, expect, test } from "bun:test";
import { type AutoAttempt, type CompactionDecision, decideCompaction, type FoldedUsage } from "./compaction";

const under: FoldedUsage = { tokens: 40_000, threshold: 100_000 };
const at: FoldedUsage = { tokens: 100_000, threshold: 100_000 };
const over: FoldedUsage = { tokens: 100_001, threshold: 100_000 };

const cases: [string, AutoAttempt | undefined, FoldedUsage | undefined, CompactionDecision][] = [
  ["manual compact under threshold", undefined, under, "native"],
  ["manual compact over threshold", undefined, over, "native"],
  ["manual compact without usage", undefined, undefined, "native"],
  ["threshold context-full under threshold", { reason: "threshold", action: "context-full" }, under, "cancel"],
  ["threshold context-full at threshold", { reason: "threshold", action: "context-full" }, at, "cancel"],
  ["threshold handoff under threshold", { reason: "threshold", action: "handoff" }, under, "cancel"],
  ["threshold remote under threshold", { reason: "threshold", action: "remote" }, under, "cancel"],
  ["threshold snapcompact under threshold", { reason: "threshold", action: "snapcompact" }, under, "cancel"],
  ["threshold shake under threshold", { reason: "threshold", action: "shake" }, under, "cancel"],
  ["threshold context-full over threshold", { reason: "threshold", action: "context-full" }, over, "fold-summary"],
  ["threshold context-full without usage", { reason: "threshold", action: "context-full" }, undefined, "fold-summary"],
  ["overflow context-full under threshold", { reason: "overflow", action: "context-full" }, under, "fold-summary"],
  ["overflow context-full over threshold", { reason: "overflow", action: "context-full" }, over, "fold-summary"],
  ["overflow context-full without usage", { reason: "overflow", action: "context-full" }, undefined, "fold-summary"],
  ["threshold handoff over threshold", { reason: "threshold", action: "handoff" }, over, "fold-summary"],
  ["threshold remote over threshold", { reason: "threshold", action: "remote" }, over, "fold-summary"],
  ["threshold snapcompact without usage", { reason: "threshold", action: "snapcompact" }, undefined, "fold-summary"],
  ["overflow handoff", { reason: "overflow", action: "handoff" }, over, "fold-summary"],
  ["overflow remote", { reason: "overflow", action: "remote" }, under, "fold-summary"],
  ["threshold shake over threshold", { reason: "threshold", action: "shake" }, over, "native"],
  ["overflow shake", { reason: "overflow", action: "shake" }, over, "native"],
  ["idle context-full", { reason: "idle", action: "context-full" }, under, "fold-summary"],
  ["idle remote", { reason: "idle", action: "remote" }, over, "fold-summary"],
  ["incomplete context-full", { reason: "incomplete", action: "context-full" }, under, "fold-summary"],
  ["idle shake", { reason: "idle", action: "shake" }, over, "native"],
];

describe("decideCompaction", () => {
  test.each(cases)("%s", (_name, attempt, usage, expected) => {
    expect(decideCompaction(attempt, usage)).toBe(expected);
  });
});
