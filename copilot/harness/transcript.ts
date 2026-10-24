import type { Action } from "@agent-fold/evals";
import { classify, FREEFORM_INPUT_KEY } from "./tools";

export type ParsedTurn = { sessionId: string; exitCode: number; prompt: string; reply: string; actions: Action[] };

type Event = { line: number; type: string; raw: Record<string, unknown> };
type Path = (string | number)[];
type FieldTypes = { string: string; number: number; boolean: boolean };
type ToolRequest = { toolCallId: string; name: string; args: Record<string, unknown> };
type Completion = { result: string; isError: boolean };

function lookup(event: Event, path: Path): unknown {
  let value: unknown = event.raw;
  for (const key of path)
    value = typeof value === "object" && value !== null ? (value as Record<string | number, unknown>)[key] : undefined;
  return value;
}

function missing(event: Event, path: Path, expected: string): Error {
  const field = path.map(key => (typeof key === "number" ? `[${key}]` : `.${key}`)).join("");
  return new Error(`copilot stdout line ${event.line}: ${event.type} missing ${expected} ${field.slice(1)}`);
}

function need<T extends keyof FieldTypes>(event: Event, type: T, ...path: Path): FieldTypes[T] {
  const value = lookup(event, path);
  if (typeof value !== type) throw missing(event, path, type);
  return value as FieldTypes[T];
}

function parseLine(text: string, line: number): Event {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`copilot stdout line ${line}: not JSON`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`copilot stdout line ${line}: not a JSON object`);
  const type = (raw as Record<string, unknown>).type;
  if (typeof type !== "string") throw new Error(`copilot stdout line ${line}: missing string type`);
  return { line, type, raw: raw as Record<string, unknown> };
}

const subagentMarkers: Path[] = [["agentId"], ["data", "agentId"], ["data", "parentToolCallId"]];

function isSubagentEvent(event: Event): boolean {
  return subagentMarkers.some(path => {
    const marker = lookup(event, path);
    return typeof marker === "string" && marker !== "";
  });
}

function toolArgs(event: Event, index: number): Record<string, unknown> {
  const path = ["data", "toolRequests", index, "arguments"];
  const args = lookup(event, path);
  if (typeof args === "string") return { [FREEFORM_INPUT_KEY]: args };
  if (typeof args !== "object" || args === null || Array.isArray(args)) throw missing(event, path, "object or string");
  return args as Record<string, unknown>;
}

function toolRequests(event: Event): ToolRequest[] {
  const requests = lookup(event, ["data", "toolRequests"]);
  if (requests === undefined) return [];
  if (!Array.isArray(requests)) throw missing(event, ["data", "toolRequests"], "array");
  return requests.map((_, index) => ({
    toolCallId: need(event, "string", "data", "toolRequests", index, "toolCallId"),
    name: need(event, "string", "data", "toolRequests", index, "name"),
    args: toolArgs(event, index),
  }));
}

function completion(event: Event): Completion {
  return need(event, "boolean", "data", "success")
    ? { result: need(event, "string", "data", "result", "content"), isError: false }
    : { result: need(event, "string", "data", "error", "message"), isError: true };
}

export function parseTurn(stdout: string): ParsedTurn {
  const prompts: string[] = [];
  const messages: { content: string; requests: ToolRequest[] }[] = [];
  const completions = new Map<string, Completion>();
  const results: { sessionId: string; exitCode: number }[] = [];

  for (const [index, text] of stdout.split("\n").entries()) {
    if (text.trim() === "") continue;
    const event = parseLine(text, index + 1);
    if (isSubagentEvent(event)) continue;
    if (event.type === "result") {
      results.push({ sessionId: need(event, "string", "sessionId"), exitCode: need(event, "number", "exitCode") });
    } else if (event.type === "user.message") {
      prompts.push(need(event, "string", "data", "content"));
    } else if (event.type === "assistant.message") {
      messages.push({ content: need(event, "string", "data", "content"), requests: toolRequests(event) });
    } else if (event.type === "tool.execution_complete") {
      completions.set(need(event, "string", "data", "toolCallId"), completion(event));
    }
  }

  if (results.length !== 1) throw new Error(`copilot stdout: expected exactly one result line, found ${results.length}`);
  if (prompts.length !== 1) throw new Error(`copilot stdout: expected exactly one main user.message, found ${prompts.length}`);
  const requests = messages.flatMap(message => message.requests);
  const requested = new Set(requests.map(request => request.toolCallId));
  for (const id of completions.keys()) {
    if (!requested.has(id)) throw new Error(`copilot stdout: tool.execution_complete ${id} has no tool request in this turn`);
  }
  const actions = requests.map(({ toolCallId, name, args }): Action => {
    const outcome = completions.get(toolCallId);
    return {
      ...classify(name, args),
      name,
      args,
      result: outcome?.result ?? null,
      isError: outcome?.isError ?? false,
      touchesSessionLog: JSON.stringify(args).includes(".jsonl"),
    };
  });
  const reply = messages.at(-1);
  if (!reply || reply.requests.length > 0)
    throw new Error("copilot stdout: the last main assistant.message is missing or has tool requests, so the turn has no reply");
  return { ...results[0], prompt: prompts[0], reply: reply.content, actions };
}
