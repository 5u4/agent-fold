import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { foldView } from "../../fold";
import { analyzeSession, calibrate, classify, countTokens, runsBeforeCompaction, simulate } from "./session-length";

const OVERHEAD = 30_000;
const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
const usage = (input: number) => ({ ...zero, input, cost: { ...zero, total: 0 } });

const user = (text: string, steering?: true): AgentMessage => ({
  role: "user",
  content: text,
  timestamp: 1,
  ...(steering ? { steering } : {}),
});
const assistant = (content: Extract<AgentMessage, { role: "assistant" }>["content"]): AgentMessage => ({
  role: "assistant",
  content,
  api: "openai-responses",
  provider: "openai",
  model: "m",
  usage: usage(0),
  stopReason: content.some(block => block.type === "toolCall") ? "toolUse" : "stop",
  timestamp: 1,
});
const toolRun = (ask: string, id: string, steer?: string): AgentMessage[] => [
  user(ask),
  assistant([{ type: "toolCall", id, name: "read", arguments: { path: `${id}.ts` } }]),
  ...(steer ? [user(steer, true)] : []),
  {
    role: "toolResult",
    toolCallId: id,
    toolName: "read",
    content: [{ type: "text", text: `${id} `.repeat(6000) }],
    isError: false,
    timestamp: 1,
  },
  assistant([{ type: "text", text: `Finished ${ask}.` }]),
];

const conversation = [
  ...toolRun("inspect a", "a"),
  user("thanks, what next?"),
  assistant([{ type: "text", text: "Inspect b." }]),
  ...toolRun("inspect b", "b", "also check c"),
  ...toolRun("inspect c", "c"),
];

function sessionFile(view: (messages: AgentMessage[]) => AgentMessage[]): string {
  const lines: unknown[] = [{ type: "session", version: 3, id: "s", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/" }];
  conversation.forEach((message, index) => {
    const sent =
      message.role === "assistant" ? { ...message, usage: usage(OVERHEAD + countTokens(view(conversation.slice(0, index)))) } : message;
    lines.push({
      type: "message",
      id: `e${index}`,
      parentId: index === 0 ? null : `e${index - 1}`,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: sent,
    });
  });
  return lines.map(line => JSON.stringify(line)).join("\n");
}

describe("analyzeSession", () => {
  test("tells a session the provider saw folded from one it saw whole", () => {
    const folded = analyzeSession(sessionFile(foldView));
    const whole = analyzeSession(sessionFile(messages => messages));
    if (!folded || !whole) throw new Error("expected both sessions to analyze");

    const foldedRuns = folded.segments.flat();
    const wholeRuns = whole.segments.flat();
    expect(foldedRuns).toHaveLength(3);
    expect(calibrate(wholeRuns)).toBe(1);
    expect(classify(foldedRuns, 1)).toBe("folded");
    expect(classify(wholeRuns, 1)).toBe("unfolded");
    expect(folded.startPrompt).toBe(OVERHEAD + countTokens([conversation[0]]));
    for (const run of foldedRuns) expect(run.reportedHistoryGrowth).toBe(run.estimatedFoldedGrowth);
    for (const run of wholeRuns) expect(run.reportedHistoryGrowth).toBe(run.estimatedUnfoldedGrowth);
  });
});

describe("runsBeforeCompaction", () => {
  test("stops at the first run whose in-flight prompt crosses the threshold", () => {
    const unfolded = runsBeforeCompaction(20_000, () => ({ historyGrowth: 10_000, inFlightGrowth: 5_000 }), 170_000);
    const folded = runsBeforeCompaction(20_000, () => ({ historyGrowth: 1_000, inFlightGrowth: 5_000 }), 170_000);
    expect(unfolded).toBe(15);
    expect(folded).toBe(146);
  });
});

describe("simulate", () => {
  test("replays the same runs in both arms of a trial", () => {
    const pool = Array.from({ length: 50 }, (_, index) => ({ historyGrowth: 1_000 * (index + 1), inFlightGrowth: 500 * index }));
    const trials = simulate({
      startPrompts: [20_000, 40_000],
      foldRulesTokens: 0,
      threshold: 170_000,
      trials: 200,
      seed: 7,
      unfolded: pool,
      folded: pool,
    });
    for (const trial of trials) expect(trial.folded).toBe(trial.unfolded);
  });
});
