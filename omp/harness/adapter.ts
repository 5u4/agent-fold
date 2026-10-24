import type { Action, Call, Harness, Run, ScriptStep, Turn } from "@agent-fold/evals";
import { runTrial } from "./run-omp";
import type { Run as OmpRun, Turn as OmpTurn, Reply, ScriptedTurn } from "./types";
import { requestWithoutIndex } from "./view";

const SEARCH_TOOLS: Record<string, true> = { grep: true, glob: true, find: true, ast_grep: true };
const SEARCH_DEVICE = /^xd:\/\/(grep|glob|find|ast_grep)\b/;

function classify(name: string, args: Record<string, unknown>): Call {
  if (typeof args.path === "string" && SEARCH_DEVICE.test(args.path)) return { kind: "search" };
  if (Object.hasOwn(SEARCH_TOOLS, name)) return { kind: "search" };
  if (name === "read") return { kind: "read", path: String(args.path) };
  if (name === "write") return { kind: "write", path: String(args.path), content: String(args.content) };
  if (name === "bash") return { kind: "shell", command: String(args.command) };
  return { kind: "other" };
}

function actions(turn: OmpTurn, turnNumber: number): Action[] {
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

export function transcriptRun(run: OmpRun): Run {
  const turns: Turn[] = run.turns.map((turn, index) => ({
    prompt: turn.prompt,
    reply: turn.stdout,
    actions: actions(turn, index + 1),
    modelInputs: turn.requests.map(requestWithoutIndex),
  }));
  return { variant: run.variant, foldHome: run.foldHome, turns };
}

export function scriptReplies(script: ScriptStep[]): Reply[] {
  return script.map(step => {
    switch (step.kind) {
      case "read":
        return { toolCall: { name: "read", arguments: { path: step.path } } };
      case "shell":
        return { toolCall: { name: "bash", arguments: { command: step.command } } };
      case "write":
        return { toolCall: { name: "write", arguments: { path: step.path, content: step.content } }, newFile: true };
      default:
        return { text: step.text };
    }
  });
}

export const ompHarness: Harness = {
  name: "omp",
  async runTrial(scenario, opts) {
    const turns = scenario.turns.map((turn): string | ScriptedTurn =>
      typeof turn === "string" ? turn : { prompt: turn.prompt, script: scriptReplies(turn.script) },
    );
    const { run, state } = await runTrial({ setup: scenario.setup, inspect: scenario.inspect, turns }, opts);
    return { run: transcriptRun(run), state };
  },
};
