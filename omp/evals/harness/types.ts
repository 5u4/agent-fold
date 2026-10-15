import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { Message } from "@oh-my-pi/pi-ai";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";

export type Variant = "without-plugin" | "with-plugin";

export type Reply = ({ text: string } | { toolCall: { name: string; arguments: Record<string, unknown> } }) & {
  inputTokens?: number;
};

export type SessionMessage = AgentMessage;

export type Turn = {
  prompt: string;
  stdout: string;
  requests: unknown[];
  messages: SessionMessage[];
  entries: SessionEntry[];
};

export type Run = { variant: Variant; foldHome: string; turns: Turn[] };

export type Verdict = { status: "pass" | "fail" | "invalid"; evidence: string };

export const FOLD_DIR = "<fold-dir>";

export type ScriptedTurn = { commands?: string[]; prompt: string; script: Reply[] };

export type ScriptedRequest = { systemPrompt: string[]; messages: Message[] };

export type Scenario<S> = {
  setup(workdir: string): Promise<S>;
  turns: (string | ScriptedTurn)[];
  inspect?(workdir: string, state: S): Promise<S>;
  grade(run: Run, state: S): Verdict;
};
