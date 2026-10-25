import { describe, expect, test } from "bun:test";
import { foldView, type LoopMessage, runTable, withIndex } from "./fold";

const user = (id: string): LoopMessage => ({ id, role: "user", content: [{ type: "text", text: id }] });
const reply = (id: string): LoopMessage => ({ id, role: "assistant", content: [{ type: "text", text: id }] });
const toolStep = (id: string): LoopMessage => ({
  id,
  role: "assistant",
  content: [{ type: "tool-call", id: `call-${id}`, name: "read", input: {} }],
});
const toolResult = (id: string): LoopMessage => ({
  role: "tool",
  content: [{ type: "tool-result", id: `call-${id}`, name: "read", result: { type: "text", value: "out" } }],
});
const entries = (...spec: string[]) =>
  spec.map((item, at) => (item === "idle" ? { id: `idle-${at}`, type: "idle" } : { id: item, type: "message" }));
const shape = (messages: LoopMessage[]) =>
  messages.map(message => `${message.role}:${message.id ?? "-"}:${message.content.map(part => part.type).join("+")}`);

describe("foldView", () => {
  test("keeps the text of the last assistant per user segment, in array order, and leaves the in-flight run whole", () => {
    const messages: LoopMessage[] = [
      user("u9"),
      {
        id: "a1",
        role: "assistant",
        content: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "early" },
        ],
      },
      user("u2"),
      toolStep("a3"),
      toolResult("a3"),
      {
        id: "a4",
        role: "assistant",
        content: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "final" },
        ],
      },
      user("u5"),
      toolStep("a6"),
      toolResult("a6"),
    ];
    const runs = runTable(entries("u9", "a1", "u2", "a3", "a4", "idle", "u5", "a6"));
    expect(shape(foldView(messages, runs))).toEqual([
      "user:u9:text",
      "assistant:a1:text",
      "user:u2:text",
      "assistant:a4:text",
      "user:u5:text",
      "assistant:a6:tool-call",
      "tool:-:tool-result",
    ]);
  });

  test("a run whose last assistant has no text keeps only its user message, and a transcript entry absent from the messages is skipped", () => {
    const messages = [user("u1"), toolStep("a2"), toolResult("a2"), user("u4"), user("u5")];
    const runs = runTable(entries("u1", "a2", "idle", "u4", "failed-assistant", "idle", "u5"));
    expect(shape(foldView(messages, runs))).toEqual(["user:u1:text", "user:u4:text", "user:u5:text"]);
  });

  test("keeps a checkpoint run and messages the transcript does not know", () => {
    const messages = [user("ckpt"), reply("a1"), reply("unknown"), user("u2")];
    const runs = runTable([{ id: "ckpt", type: "compaction" }, ...entries("a1", "idle", "u2")]);
    expect(shape(foldView(messages, runs))).toEqual(["user:ckpt:text", "assistant:a1:text", "assistant:unknown:text", "user:u2:text"]);
  });
});

describe("withIndex", () => {
  const index = user("index");

  test("follows the in-flight run's first user message", () => {
    const view = [user("u1"), reply("a1"), user("u2"), user("u3")];
    expect(shape(withIndex(view, runTable(entries("u1", "a1", "idle", "u2", "u3")), index))).toEqual([
      "user:u1:text",
      "assistant:a1:text",
      "user:u2:text",
      "user:index:text",
      "user:u3:text",
    ]);
  });

  test("follows the checkpoint when auto compaction left the in-flight run without a user entry", () => {
    expect(shape(withIndex([user("ckpt")], runTable([{ id: "ckpt", type: "compaction" }]), index))).toEqual([
      "user:ckpt:text",
      "user:index:text",
    ]);
  });

  test("leaves the view unchanged when no in-flight message is a user message", () => {
    expect(shape(withIndex([user("u1"), reply("a1")], runTable(entries("u1", "a1", "idle")), index))).toEqual([
      "user:u1:text",
      "assistant:a1:text",
    ]);
  });
});
