import { expect, test } from "bun:test";
import { type Injection, type JsonObject, rewriteBody } from "./fold";
import { messages, responses } from "./formats";

const fixture = async (name: string): Promise<JsonObject> => Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url)).json();

const keys: string[] = [];
const injection: Injection = {
  rules: "RULES",
  index: key => {
    keys.push(key);
    return "INDEX";
  },
};

const responsesIndex = { type: "message", role: "user", content: [{ type: "input_text", text: "INDEX" }] };
const messagesIndex = { role: "user", content: [{ type: "text", text: "INDEX" }] };

test("responses: a finished run keeps its prompt, steering, notifications and final answer; tools and reasoning go", async () => {
  const body = await fixture("responses-steering");
  const input = body.input as JsonObject[];
  keys.length = 0;
  const out = rewriteBody(responses, body, injection);
  expect(out?.input).toEqual([input[0], input[1], input[5], input[6], input[18], input[19], responsesIndex]);
  expect(out?.instructions).toBe(`${body.instructions}\n\nRULES`);
  expect(keys).toEqual([(input[19].content as { text: string }[])[0].text]);
});

test("responses: a run that stopped after a tool output stays whole", async () => {
  const body = await fixture("responses-steering");
  const input = body.input as JsonObject[];
  const unfinished = [...input.slice(0, 18), input[19]];
  const out = rewriteBody(responses, { ...body, input: unfinished }, injection);
  expect(out?.input).toEqual([...unfinished, responsesIndex]);
});

test("responses: after compaction the summary starts its own run and the index follows the new prompt", async () => {
  const body = await fixture("responses-compaction");
  const input = body.input as JsonObject[];
  expect(rewriteBody(responses, body, injection)?.input).toEqual([input[0], input[1], responsesIndex, ...input.slice(2)]);
});

test("responses: a request without a run boundary, like the frustration classifier, is not rewritten", async () => {
  expect(rewriteBody(responses, await fixture("responses-classifier"), injection)).toBeUndefined();
});

test("responses: a system input item gets the rules when there are no instructions", () => {
  const system = { type: "message", role: "system", content: [{ type: "input_text", text: "SYS" }] };
  const prompt = { type: "message", role: "user", content: [{ type: "input_text", text: "<current_datetime>t</current_datetime>\n\nhi" }] };
  expect(rewriteBody(responses, { input: [system, prompt] }, injection)).toEqual({
    input: [
      {
        type: "message",
        role: "system",
        content: [
          { type: "input_text", text: "SYS" },
          { type: "input_text", text: "RULES" },
        ],
      },
      prompt,
      responsesIndex,
    ],
  });
});

test("messages: a finished run keeps the prompt, steering, notifications and text-only replies; tool turns go", async () => {
  const body = await fixture("messages-steering");
  const list = body.messages as JsonObject[];
  const out = rewriteBody(messages, body, injection);
  expect(out?.messages).toEqual([list[0], list[5], list[8], list[9], list[18], list[19], messagesIndex]);
  expect(out?.system).toEqual([...(body.system as JsonObject[]), { type: "text", text: "RULES" }]);
});

test("messages: thinking is stripped from a kept reply, signatures elsewhere survive", async () => {
  const body = await fixture("messages-thinking-reply");
  const list = body.messages as JsonObject[];
  expect(rewriteBody(messages, body, injection)?.messages).toEqual([
    list[0],
    { role: "assistant", content: [{ type: "text", text: "16" }] },
    list[2],
    list[5],
    list[6],
    messagesIndex,
  ]);
});

test("messages: a tool_result message with steering text keeps only the text", () => {
  const prompt = (t: string) => ({ role: "user", content: [{ type: "text", text: `<current_datetime>${t}</current_datetime>\n\ngo` }] });
  const call = { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "bash", input: {} }] };
  const mixed = {
    role: "user",
    content: [
      { type: "tool_result", tool_use_id: "t1", content: "secret" },
      { type: "text", text: "also do x" },
    ],
  };
  const reply = { role: "assistant", content: [{ type: "text", text: "done" }] };
  expect(rewriteBody(messages, { messages: [prompt("1"), call, mixed, reply, prompt("2")] }, injection)?.messages).toEqual([
    prompt("1"),
    { role: "user", content: [{ type: "text", text: "also do x" }] },
    reply,
    prompt("2"),
    messagesIndex,
  ]);
});

test("messages: after compaction the summary message is the run boundary and gets the index after it", async () => {
  const body = await fixture("messages-compaction");
  const list = body.messages as JsonObject[];
  expect(rewriteBody(messages, body, injection)?.messages).toEqual([list[0], messagesIndex, list[1], list[2]]);
});
