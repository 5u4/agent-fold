import type { SessionContext } from "@opencode/plugin/promise/session";

export type LoopMessage = SessionContext["messages"][number];

export type TranscriptEntry = { readonly id: string; readonly type: string };

export type RunTable = {
  readonly ended: ReadonlyMap<string, number>;
  readonly inFlight: ReadonlySet<string>;
  readonly start: string | undefined;
};

export function runTable(transcript: readonly TranscriptEntry[]): RunTable {
  const ended = new Map<string, number>();
  let inFlight: string[] = [];
  let run = 0;
  for (const entry of transcript) {
    if (entry.type !== "idle") {
      inFlight.push(entry.id);
      continue;
    }
    for (const id of inFlight) ended.set(id, run);
    inFlight = [];
    run++;
  }
  return { ended, inFlight: new Set(inFlight), start: inFlight[0] };
}

function lastAssistants(messages: readonly LoopMessage[], { ended }: RunTable): Set<number> {
  const last = new Map<string, number>();
  let segment = 0;
  messages.forEach((message, index) => {
    const run = message.id === undefined ? undefined : ended.get(message.id);
    if (run === undefined) return;
    if (message.role === "user") segment++;
    else if (message.role === "assistant") last.set(`${run}:${segment}`, index);
  });
  return new Set(last.values());
}

export function foldView(messages: readonly LoopMessage[], runs: RunTable): LoopMessage[] {
  const replies = lastAssistants(messages, runs);
  const out: LoopMessage[] = [];
  let ownerRun: number | undefined;
  messages.forEach((message, index) => {
    if (message.id !== undefined) ownerRun = runs.ended.get(message.id);
    if (ownerRun === undefined || (message.role !== "assistant" && message.role !== "tool")) {
      out.push(message);
      return;
    }
    if (!replies.has(index)) return;
    const content = message.content.filter(part => part.type === "text");
    if (content.length > 0) out.push({ ...message, content });
  });
  return out;
}

export function withIndex(view: readonly LoopMessage[], { inFlight }: RunTable, index: LoopMessage): LoopMessage[] {
  const at = view.findIndex(message => message.role === "user" && message.id !== undefined && inFlight.has(message.id));
  if (at === -1) return [...view];
  return [...view.slice(0, at + 1), index, ...view.slice(at + 1)];
}
