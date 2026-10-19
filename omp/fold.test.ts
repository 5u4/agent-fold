import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { foldSettled, foldView } from "./fold";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const user = (text: string, steering?: true): AgentMessage => ({
  role: "user",
  content: text,
  timestamp: 0,
  ...(steering ? { steering } : {}),
});

const assistant = (
  content: Extract<AgentMessage, { role: "assistant" }>["content"],
  stopReason: "stop" | "toolUse" | "aborted" | "error" = "stop",
): AgentMessage => ({
  role: "assistant",
  content,
  api: "openai-responses",
  provider: "openai",
  model: "m",
  usage,
  stopReason,
  timestamp: 0,
});

const call = (id: string): AgentMessage => assistant([{ type: "toolCall", id, name: "read", arguments: {} }], "toolUse");

const result = (id: string): AgentMessage => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "read",
  content: [{ type: "text", text: `result ${id}` }],
  isError: false,
  timestamp: 0,
});

const reply = (text: string): AgentMessage => assistant([{ type: "text", text }]);

const summary = (text: string): AgentMessage => ({
  role: "compactionSummary",
  summary: text,
  tokensBefore: 0,
  timestamp: 0,
});

const custom = (customType: string, content: string, attribution: "user" | "agent"): AgentMessage => ({
  role: "custom",
  customType,
  content,
  display: true,
  attribution,
  timestamp: 0,
});

const skill = (text: string): AgentMessage => custom("skill-prompt", `SKILL BODY\n\n${text}`, "user");

const notice = (customType: string): AgentMessage => custom(customType, "notice", "agent");

const agentCustom = (customType: string): AgentMessage => custom(customType, "injected", "agent");

const developer = (text: string): AgentMessage => ({ role: "developer", content: text, timestamp: 0 });

const fileMention: AgentMessage = { role: "fileMention", files: [{ path: "a.ts", content: "a" }], timestamp: 0 };

const bash: AgentMessage = {
  role: "bashExecution",
  command: "ls",
  output: "a.ts",
  exitCode: 0,
  cancelled: false,
  truncated: false,
  timestamp: 0,
};

describe("foldView", () => {
  test("folds a completed run to its user message and final reply", () => {
    const messages = [user("q1"), call("a"), result("a"), reply("done 1"), user("q2")];
    expect(foldView(messages)).toEqual([user("q1"), reply("done 1"), user("q2")]);
  });

  test("leaves the last run untouched while it is in progress", () => {
    const messages = [user("q1"), reply("done 1"), user("q2"), call("a"), result("a")];
    expect(foldView(messages)).toEqual([user("q1"), reply("done 1"), user("q2"), call("a"), result("a")]);
  });

  test("leaves the last run untouched after it completes", () => {
    const messages = [user("q1"), call("a"), result("a"), reply("done 1")];
    expect(foldView(messages)).toEqual([user("q1"), call("a"), result("a"), reply("done 1")]);
  });

  test("keeps steering messages in place and does not start a run at them", () => {
    const messages = [user("q1"), call("a"), user("steer", true), result("a"), reply("done 1"), user("q2")];
    expect(foldView(messages)).toEqual([user("q1"), user("steer", true), reply("done 1"), user("q2")]);
  });

  test("keeps every final reply when a steering message starts a second turn", () => {
    const messages = [
      user("q1"),
      call("a"),
      result("a"),
      reply("done 1"),
      user("steer", true),
      call("b"),
      result("b"),
      reply("done 2"),
      user("q2"),
    ];
    expect(foldView(messages)).toEqual([user("q1"), reply("done 1"), user("steer", true), reply("done 2"), user("q2")]);
  });

  test("treats a follow-up user message as a run boundary", () => {
    const messages = [user("q1"), call("a"), result("a"), reply("done 1"), user("follow-up"), call("b"), result("b")];
    expect(foldView(messages)).toEqual([user("q1"), reply("done 1"), user("follow-up"), call("b"), result("b")]);
  });

  test("starts a run at a compaction summary whose tail begins mid-run", () => {
    const messages = [summary("s"), result("a"), call("b"), result("b"), reply("done 1"), user("q2")];
    expect(foldView(messages)).toEqual([summary("s"), reply("done 1"), user("q2")]);
  });

  test("passes messages before the first run start through", () => {
    const messages = [notice("tool-roster-notice"), user("q1"), reply("done 1"), user("q2")];
    expect(foldView(messages)).toEqual([notice("tool-roster-notice"), user("q1"), reply("done 1"), user("q2")]);
  });

  test("folds a first run opened by a skill prompt to the prompt and final reply", () => {
    const messages = [skill("probe q1"), call("a"), result("a"), reply("done 1"), user("q2")];
    expect(foldView(messages)).toEqual([skill("probe q1"), reply("done 1"), user("q2")]);
  });

  test("a skill prompt after a final reply opens a run, so the previous run folds", () => {
    const messages = [user("q1"), call("a"), result("a"), reply("done 1"), skill("probe q2"), call("b"), result("b")];
    expect(foldView(messages)).toEqual([user("q1"), reply("done 1"), skill("probe q2"), call("b"), result("b")]);
  });

  test("a skill prompt injected after a tool call stays inside the run", () => {
    const messages = [user("q1"), call("a"), skill("probe aside"), result("a"), reply("done 1"), user("q2")];
    expect(foldView(messages)).toEqual([user("q1"), skill("probe aside"), reply("done 1"), user("q2")]);
  });

  test("steering that arrives after a final reply opens a run", () => {
    const messages = [user("q1"), call("a"), result("a"), reply("done 1"), user("late", true), call("b"), result("b")];
    expect(foldView(messages)).toEqual([user("q1"), reply("done 1"), user("late", true), call("b"), result("b")]);
  });

  test("drops agent-injected messages from a folded run and keeps user context in place", () => {
    const messages = [
      user("q1"),
      agentCustom("eager-task-prelude"),
      call("a"),
      notice("xdev-mount-notice"),
      fileMention,
      result("a"),
      agentCustom("async-result"),
      developer("reminder"),
      bash,
      reply("done 1"),
      user("q2"),
    ];
    expect(foldView(messages)).toEqual([user("q1"), notice("xdev-mount-notice"), fileMention, bash, reply("done 1"), user("q2")]);
  });

  test("keeps only the last final reply when the agent continued after a text reply", () => {
    const messages = [
      user("q1"),
      call("a"),
      result("a"),
      reply("early"),
      developer("You stopped with 1 incomplete todo item(s)"),
      call("b"),
      result("b"),
      reply("done 1"),
      user("q2"),
    ];
    expect(foldView(messages)).toEqual([user("q1"), reply("done 1"), user("q2")]);
  });

  test("leaves aborted, errored, and tool-call-ending runs untouched", () => {
    const aborted = assistant([{ type: "text", text: "partial" }], "aborted");
    const errored = assistant([{ type: "text", text: "partial" }], "error");
    const messages = [
      user("q1"),
      call("a"),
      result("a"),
      aborted,
      user("q2"),
      call("b"),
      result("b"),
      errored,
      user("q3"),
      call("c"),
      user("q4"),
      reply("done 4"),
      user("q5"),
    ];
    expect(foldView(messages)).toEqual([
      user("q1"),
      call("a"),
      result("a"),
      assistant([{ type: "text", text: "partial" }], "aborted"),
      user("q2"),
      call("b"),
      result("b"),
      assistant([{ type: "text", text: "partial" }], "error"),
      user("q3"),
      call("c"),
      user("q4"),
      reply("done 4"),
      user("q5"),
    ]);
  });

  test("strips thinking from the kept reply", () => {
    const thinkingReply = assistant([
      { type: "thinking", thinking: "hmm", thinkingSignature: "sig" },
      { type: "redactedThinking", data: "opaque" },
      { type: "text", text: "done 1" },
    ]);
    const messages = [user("q1"), call("a"), result("a"), thinkingReply, user("q2")];
    expect(foldView(messages)).toEqual([user("q1"), reply("done 1"), user("q2")]);
  });

  test("leaves a run unfolded when its reply is thinking only", () => {
    const thinkingOnly = assistant([{ type: "thinking", thinking: "hmm", thinkingSignature: "sig" }]);
    const messages = [user("q1"), call("a"), result("a"), thinkingOnly, user("q2")];
    expect(foldView(messages)).toEqual([
      user("q1"),
      call("a"),
      result("a"),
      assistant([{ type: "thinking", thinking: "hmm", thinkingSignature: "sig" }]),
      user("q2"),
    ]);
  });
});

describe("foldSettled", () => {
  test("folds the last run once it has a final reply", () => {
    const messages = [user("q1"), call("a"), result("a"), reply("done 1"), user("q2"), call("b"), result("b"), reply("done 2")];
    expect(foldSettled(messages)).toEqual([user("q1"), reply("done 1"), user("q2"), reply("done 2")]);
  });

  test("leaves a last run that stopped on a tool call unfolded", () => {
    const messages = [user("q1"), call("a"), result("a"), reply("done 1"), user("q2"), call("b")];
    expect(foldSettled(messages)).toEqual([user("q1"), reply("done 1"), user("q2"), call("b")]);
  });
});
