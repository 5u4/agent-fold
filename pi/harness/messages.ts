import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const user = (text: string, timestamp = 0): AgentMessage => ({ role: "user", content: text, timestamp });

export const assistant = (
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
  timestamp = 0,
): AgentMessage => ({
  role: "assistant",
  content,
  api: "openai-completions",
  provider: "fake",
  model: "fake",
  usage,
  stopReason,
  timestamp,
});

export const call = (...ids: string[]): AgentMessage =>
  assistant(
    ids.map(id => ({ type: "toolCall", id, name: "read", arguments: {} })),
    "toolUse",
  );

export const reply = (text: string, timestamp = 0): AgentMessage => assistant([{ type: "text", text }], "stop", timestamp);

export const result = (id: string, text = `result ${id}`, isError = false): AgentMessage => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "read",
  content: [{ type: "text", text }],
  isError,
  timestamp: 0,
});

export const custom = (customType: string, display: boolean): AgentMessage => ({
  role: "custom",
  customType,
  content: customType,
  display,
  timestamp: 0,
});

export const bash = (command: string): AgentMessage => ({
  role: "bashExecution",
  command,
  output: "out",
  exitCode: 0,
  cancelled: false,
  truncated: false,
  timestamp: 0,
});

export const compactionSummary = (timestamp = 0): AgentMessage => ({ role: "compactionSummary", summary: "s", tokensBefore: 0, timestamp });

export const branchSummary: AgentMessage = { role: "branchSummary", summary: "b", fromId: null, timestamp: 0 };
