import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

export const ABORTED_TOOL_RESULT_TEXT = "Operation aborted";

const FINAL_STOPS: Partial<Record<AssistantMessage["stopReason"], true>> = { stop: true, length: true };

function finalReply(message: AgentMessage): AssistantMessage | undefined {
  if (message.role !== "assistant" || !Object.hasOwn(FINAL_STOPS, message.stopReason)) return undefined;
  if (message.content.some(block => block.type === "toolCall")) return undefined;
  const content = message.content.filter(block => block.type !== "thinking");
  return content.some(block => block.type === "text" && block.text.trim() !== "") ? { ...message, content } : undefined;
}

function keptInFold(message: AgentMessage): boolean {
  switch (message.role) {
    case "user":
    case "bashExecution":
    case "system":
      return true;
    case "custom":
      return message.display;
    default:
      return false;
  }
}

export function runStarts(messages: AgentMessage[]): number[] {
  const starts: number[] = [];
  let unanswered: Set<string> | undefined;
  messages.forEach((message, index) => {
    switch (message.role) {
      case "user":
        if (unanswered?.size !== 0) starts.push(index);
        break;
      case "assistant":
        unanswered =
          message.stopReason === "toolUse"
            ? new Set(message.content.flatMap(block => (block.type === "toolCall" ? [block.id] : [])))
            : undefined;
        break;
      case "toolResult": {
        const [block] = message.content;
        const aborted = message.isError && message.content.length === 1 && block.type === "text" && block.text === ABORTED_TOOL_RESULT_TEXT;
        if (aborted) unanswered = undefined;
        else unanswered?.delete(message.toolCallId);
        break;
      }
      case "compactionSummary":
      case "branchSummary":
        unanswered = undefined;
    }
  });
  return starts;
}

function runEnd(messages: AgentMessage[], start: number, next: number): number {
  const summary = messages
    .slice(start, next)
    .findIndex(message => message.role === "compactionSummary" || message.role === "branchSummary");
  return summary === -1 ? next : start + summary;
}

function foldRun(run: AgentMessage[]): AgentMessage[] {
  const lastIndex = run.findLastIndex(message => message.role === "assistant");
  const reply = lastIndex < 1 ? undefined : finalReply(run[lastIndex]);
  if (!reply) return run;
  return [run[0], ...run.slice(1, lastIndex).filter(keptInFold), reply, ...run.slice(lastIndex + 1).filter(keptInFold)];
}

function foldRuns(messages: AgentMessage[], foldLast: boolean): AgentMessage[] {
  const starts = runStarts(messages);
  const folded = foldLast ? starts.length : starts.length - 1;
  if (folded < 1) return messages;
  const nexts = [...starts.slice(1), messages.length];
  const out = messages.slice(0, starts[0]);
  starts.forEach((start, k) => {
    const end = runEnd(messages, start, nexts[k]);
    const run = messages.slice(start, end);
    out.push(...(k < folded ? foldRun(run) : run), ...messages.slice(end, nexts[k]));
  });
  return out;
}

export function foldView(messages: AgentMessage[]): AgentMessage[] {
  return foldRuns(messages, false);
}

export function foldSettled(messages: AgentMessage[]): AgentMessage[] {
  return foldRuns(messages, true);
}
