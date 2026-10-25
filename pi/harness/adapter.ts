import type { Action, Call, Harness, Run } from "@agent-fold/evals";
import { INDEX_HEADER } from "../session-index";
import { type PiRun, type PiTurn, runTrial } from "./run-pi";

const SEARCH_TOOLS: Record<string, true> = { grep: true, find: true, ls: true };

function classify(name: string, args: Record<string, unknown>): Call {
  if (Object.hasOwn(SEARCH_TOOLS, name)) return { kind: "search" };
  if (name === "read") return { kind: "read", path: String(args.path) };
  if (name === "write") return { kind: "write", path: String(args.path), content: String(args.content) };
  if (name === "bash") return { kind: "shell", command: String(args.command) };
  return { kind: "other" };
}

function actions(turn: PiTurn, turnNumber: number): Action[] {
  const calls = turn.messages
    .flatMap(message => (message.role === "assistant" ? message.content : []))
    .flatMap(block => (block.type === "toolCall" ? [block] : []));
  const callIds = new Set(calls.map(call => call.id));
  const results = new Map(
    turn.messages.flatMap(message => (message.role === "toolResult" ? [[message.toolCallId, message] as const] : [])),
  );
  for (const id of results.keys()) {
    if (!callIds.has(id)) throw new Error(`turn ${turnNumber} has a tool result ${id} with no matching tool call`);
  }
  return calls.map(({ id, name, arguments: args }) => {
    const result = results.get(id);
    return {
      ...classify(name, args),
      name,
      args,
      result: result ? result.content.map(block => (block.type === "text" ? block.text : "")).join("\n") : null,
      isError: result?.isError === true,
      touchesSessionLog: JSON.stringify(args).includes(".jsonl"),
    };
  });
}

export function requestWithoutIndex(request: unknown): string {
  return JSON.stringify(request, (_key, value) => (typeof value === "string" && value.startsWith(INDEX_HEADER) ? undefined : value));
}

export function transcriptRun(run: PiRun): Run {
  return {
    variant: run.variant,
    foldHome: run.foldHome,
    turns: run.turns.map((turn, index) => ({
      prompt: turn.prompt,
      reply: turn.reply,
      actions: actions(turn, index + 1),
      modelInputs: turn.requests.map(requestWithoutIndex),
    })),
  };
}

export const piHarness: Harness = {
  name: "pi",
  async runTrial(scenario, opts) {
    const { run, state } = await runTrial(scenario, opts);
    return { run: transcriptRun(run), state };
  },
};
