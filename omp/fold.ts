import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { isUserAuthoredMessage, sanitizeAssistantForReparentedHistory } from "@oh-my-pi/pi-coding-agent/session/messages";

function finalReply(message: AgentMessage): AssistantMessage | undefined {
  if (message.role !== "assistant") return undefined;
  if (message.stopReason === "aborted" || message.stopReason === "error") return undefined;
  if (message.content.some(block => block.type === "toolCall")) return undefined;
  const sanitized = sanitizeAssistantForReparentedHistory(message);
  const content = sanitized.content.filter(block => block.type !== "thinking");
  return content.some(block => block.type === "text" && block.text.trim() !== "") ? { ...sanitized, content } : undefined;
}

const KEPT_ROLES: Partial<Record<AgentMessage["role"], true>> = { fileMention: true, bashExecution: true, pythonExecution: true };

const KEPT_NOTICES: Record<string, true> = {
  "xdev-mount-notice": true,
  "tool-roster-notice": true,
  "eval-prelude-notice": true,
  "session-agent-notice": true,
};

function keptInFold(message: AgentMessage): boolean {
  return (
    isUserAuthoredMessage(message) ||
    Object.hasOwn(KEPT_ROLES, message.role) ||
    (message.role === "custom" && Object.hasOwn(KEPT_NOTICES, message.customType))
  );
}

function foldRun(run: AgentMessage[]): AgentMessage[] {
  const lastIndex = run.findLastIndex(message => message.role === "assistant");
  const reply = lastIndex < 1 ? undefined : finalReply(run[lastIndex]);
  if (!reply) return run;
  return [run[0], ...run.slice(1, lastIndex).filter(keptInFold), reply, ...run.slice(lastIndex + 1).filter(keptInFold)];
}

export function runStarts(messages: AgentMessage[]): number[] {
  const starts: number[] = [];
  let midRun = false;
  messages.forEach((message, index) => {
    if (message.role === "compactionSummary" || message.role === "branchSummary" || (!midRun && isUserAuthoredMessage(message))) starts.push(index);
    if (message.role === "assistant") midRun = message.stopReason === "toolUse";
  });
  return starts;
}

function foldRuns(messages: AgentMessage[], foldLast: boolean): AgentMessage[] {
  const starts = runStarts(messages);
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
