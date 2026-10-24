import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { calculatePromptTokens } from "@oh-my-pi/pi-agent-core/compaction";
import { Tokenizer } from "@oh-my-pi/pi-agent-core/tokenizer";
import { isUserAuthoredMessage } from "@oh-my-pi/pi-coding-agent/session/messages";
import { buildSessionContext } from "@oh-my-pi/pi-coding-agent/session/session-context";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { parseSessionEntries } from "@oh-my-pi/pi-coding-agent/session/session-loader";
import { foldSettled, runStarts } from "../fold";

export type Run = {
  firstPrompt: number;
  inFlightGrowth: number;
  reportedHistoryGrowth: number;
  estimatedUnfoldedGrowth: number;
  estimatedFoldedGrowth: number;
};

export type Segment = Run[];
export type Mode = "folded" | "unfolded" | "ambiguous";
export type Session = { key: string; runCount: number; startPrompt: number | undefined; segments: Segment[] };
export type Footprint = { historyGrowth: number; inFlightGrowth: number };
export type Trial = { unfolded: number; folded: number };

const tokenizer = new Tokenizer();
const MIN_REMOVED_TOKENS = 2000;

export const countTokens = (messages: AgentMessage[]) =>
  tokenizer.countMessages(
    messages.map(message =>
      message.role === "assistant"
        ? { ...message, content: message.content.filter(block => block.type !== "thinking" && block.type !== "redactedThinking") }
        : message,
    ),
  );

type RawRun = { messages: AgentMessage[]; firstPrompt: number; inFlightGrowth: number; model: string } | undefined;

function splitRuns(messages: AgentMessage[]): RawRun[] {
  const starts = runStarts(messages);
  const ends = [...starts.slice(1), messages.length];
  return starts.map((start, k): RawRun => {
    const slice = messages.slice(start, ends[k]);
    const prompts = slice.flatMap(message =>
      message.role === "assistant" && message.stopReason !== "aborted" && message.stopReason !== "error"
        ? [{ prompt: calculatePromptTokens(message.usage), model: `${message.provider}/${message.model}` }]
        : [],
    );
    if (prompts.length === 0 || prompts.some(p => p.prompt <= 0 || p.model !== prompts[0].model)) return undefined;
    const firstPrompt = prompts[0].prompt;
    return {
      messages: slice,
      firstPrompt,
      inFlightGrowth: Math.max(...prompts.map(p => p.prompt)) - firstPrompt,
      model: prompts[0].model,
    };
  });
}

function segmentsOf(runs: RawRun[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | undefined;
  runs.forEach((run, k) => {
    if (!run) {
      current = undefined;
      return;
    }
    if (!current) {
      current = [];
      segments.push(current);
    }
    const next = runs[k + 1];
    if (!next || next.model !== run.model) {
      current = undefined;
      return;
    }
    const nextUser = countTokens([next.messages[0]]);
    current.push({
      firstPrompt: run.firstPrompt,
      inFlightGrowth: run.inFlightGrowth,
      reportedHistoryGrowth: next.firstPrompt - run.firstPrompt,
      estimatedUnfoldedGrowth: countTokens(run.messages.slice(1)) + nextUser,
      estimatedFoldedGrowth: countTokens(foldSettled(run.messages).slice(1)) + nextUser,
    });
  });
  return segments.filter(segment => segment.length > 0);
}

export function calibrate(runs: Run[]): number | undefined {
  const unfoldable = runs.filter(run => run.estimatedUnfoldedGrowth === run.estimatedFoldedGrowth && run.reportedHistoryGrowth > 0);
  return unfoldable.length > 0
    ? quantile(
        unfoldable.map(run => run.reportedHistoryGrowth / run.estimatedUnfoldedGrowth),
        0.5,
      )
    : undefined;
}

export function classify(runs: Run[], calibration: number): Mode {
  const telling = runs.filter(run => run.estimatedUnfoldedGrowth - run.estimatedFoldedGrowth >= MIN_REMOVED_TOKENS);
  if (telling.length === 0) return "ambiguous";
  const folded = telling.filter(
    run =>
      run.reportedHistoryGrowth > 0 &&
      Math.abs(Math.log(run.reportedHistoryGrowth / (calibration * run.estimatedFoldedGrowth))) <
        Math.abs(Math.log(run.reportedHistoryGrowth / (calibration * run.estimatedUnfoldedGrowth))),
  ).length;
  if (folded === 0) return "unfolded";
  return folded / telling.length >= 2 / 3 ? "folded" : "ambiguous";
}

export function analyzeSession(content: string): Session | undefined {
  const entries = parseSessionEntries(content).filter((entry): entry is SessionEntry => entry.type !== "session");
  const { messages } = buildSessionContext(entries);
  const starts = runStarts(messages);
  const firstUser = starts
    .map(start => messages[start])
    .find((message): message is Extract<AgentMessage, { role: "user" | "custom" }> => isUserAuthoredMessage(message));
  if (!firstUser) return undefined;
  const runs = splitRuns(messages);
  return {
    key: `${firstUser.timestamp}:${JSON.stringify(firstUser.content).slice(0, 200)}`,
    runCount: starts.length,
    startPrompt: runs[0]?.firstPrompt,
    segments: segmentsOf(runs),
  };
}

export function runsBeforeCompaction(startPrompt: number, next: () => Footprint, threshold: number, limit = 100_000): number {
  let history = startPrompt;
  for (let finished = 0; finished < limit; finished++) {
    const run = next();
    if (history + run.inFlightGrowth > threshold) return finished;
    history += run.historyGrowth;
  }
  return limit;
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type SimulationInput = {
  startPrompts: number[];
  foldRulesTokens: number;
  threshold: number;
  trials: number;
  seed: number;
  unfolded: Footprint[];
  folded: Footprint[];
};

export function simulate(input: SimulationInput): Trial[] {
  const random = mulberry32(input.seed);
  return Array.from({ length: input.trials }, () => {
    const startPrompt = input.startPrompts[Math.floor(random() * input.startPrompts.length)];
    const trialSeed = Math.floor(random() * 2 ** 32);
    const draw = (pool: Footprint[]) => {
      const trialRandom = mulberry32(trialSeed);
      return () => pool[Math.floor(trialRandom() * pool.length)];
    };
    return {
      unfolded: runsBeforeCompaction(startPrompt, draw(input.unfolded), input.threshold),
      folded: runsBeforeCompaction(startPrompt + input.foldRulesTokens, draw(input.folded), input.threshold),
    };
  });
}

export function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}
