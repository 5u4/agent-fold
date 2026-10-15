import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { sanitizeAssistantForReparentedHistory } from "@oh-my-pi/pi-coding-agent/session/messages";

function finalReply(message: AgentMessage): AssistantMessage | undefined {
  if (message.role !== "assistant") return undefined;
  if (message.stopReason === "aborted" || message.stopReason === "error") return undefined;
  if (message.content.some(block => block.type === "toolCall")) return undefined;
  const sanitized = sanitizeAssistantForReparentedHistory(message);
  const content = sanitized.content.filter(block => block.type !== "thinking");
  return content.some(block => block.type === "text" && block.text.trim() !== "") ? { ...sanitized, content } : undefined;
}

function foldRun(run: AgentMessage[]): AgentMessage[] {
  const lastIndex = run.findLastIndex(message => message.role === "assistant");
  if (lastIndex < 1 || !finalReply(run[lastIndex])) return run;
  const kept = run.slice(1).flatMap((message): AgentMessage[] => {
    if (message.role === "toolResult") return [];
    if (message.role !== "assistant") return [message];
    const reply = finalReply(message);
    return reply ? [reply] : [];
  });
  return [run[0], ...kept];
}

export function startsRun(message: AgentMessage): boolean {
  return message.role === "user" ? message.steering !== true : message.role === "compactionSummary" || message.role === "branchSummary";
}

function foldRuns(messages: AgentMessage[], foldLast: boolean): AgentMessage[] {
  const starts = messages.flatMap((message, index) => (startsRun(message) ? [index] : []));
  const folded = foldLast ? starts.length : starts.length - 1;
  if (folded < 1) return messages;
  const ends = [...starts.slice(1), messages.length];
  const runs = starts.slice(0, folded).flatMap((start, k) => foldRun(messages.slice(start, ends[k])));
  return [...messages.slice(0, starts[0]), ...runs, ...messages.slice(ends[folded - 1])];
}

export function foldView(messages: AgentMessage[]): AgentMessage[] {
  return foldRuns(messages, false);
}

export function foldSettled(messages: AgentMessage[]): AgentMessage[] {
  return foldRuns(messages, true);
}
