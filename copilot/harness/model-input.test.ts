import { expect, test } from "bun:test";
import { type Injection, type JsonObject, rewriteBody } from "../fold";
import { formats } from "../formats";
import { indexMessage } from "../session-index";
import { modelInputText, stripIndexSnapshot } from "./model-input";

const DIR = "/fold-home/-tmp-work/copilot/20261024180741-5894b1be-0000-4000-8000-000000000000";

const injection: Injection = { rules: "RULES", index: () => indexMessage(DIR, "- retries.md: production retry count\n") };

const fixture = async (name: string): Promise<JsonObject> => Bun.file(new URL(`../fixtures/${name}.json`, import.meta.url)).json();

async function folded(name: string, path: "/v1/messages" | "/responses"): Promise<{ original: JsonObject[]; body: JsonObject }> {
  const body = await fixture(name);
  const rewritten = rewriteBody(formats[path], body, injection);
  if (rewritten === undefined) throw new Error(`${name} has no run boundary`);
  return { original: (path === "/responses" ? body.input : body.messages) as JsonObject[], body: rewritten };
}

test("responses: the snapshot after the last boundary is stripped from a folded request", async () => {
  const { original: input, body } = await folded("responses-steering", "/responses");
  const stripped = stripIndexSnapshot("/responses", body, DIR);
  expect(stripped.found).toBe(true);
  expect(stripped.body.input).toEqual([input[0], input[1], input[5], input[6], input[18], input[19]]);
});

test("responses: after compaction the snapshot sits mid-list and is still stripped", async () => {
  const { original: input, body } = await folded("responses-compaction", "/responses");
  const stripped = stripIndexSnapshot("/responses", body, DIR);
  expect(stripped.found).toBe(true);
  expect(stripped.body.input).toEqual(input);
});

test("messages: the snapshot after the last boundary is stripped from a folded request", async () => {
  const { original: list, body } = await folded("messages-steering", "/v1/messages");
  const stripped = stripIndexSnapshot("/v1/messages", body, DIR);
  expect(stripped.found).toBe(true);
  expect(stripped.body.messages).toEqual([list[0], list[5], list[8], list[9], list[18], list[19]]);
});

test("messages: after compaction the snapshot after the summary is stripped", async () => {
  const { original: list, body } = await folded("messages-compaction", "/v1/messages");
  const stripped = stripIndexSnapshot("/v1/messages", body, DIR);
  expect(stripped.found).toBe(true);
  expect(stripped.body.messages).toEqual([list[0], list[1], list[2]]);
});

test("a snapshot naming another fold dir is not this session's and stays", async () => {
  const { body } = await folded("messages-steering", "/v1/messages");
  expect(stripIndexSnapshot("/v1/messages", body, "/fold-home/other")).toEqual({ body, found: false });
});

test("a snapshot that is not right after the last boundary stays", () => {
  const prompt = (t: string) => ({ role: "user", content: [{ type: "text", text: `<current_datetime>${t}</current_datetime>\n\ngo` }] });
  const snapshot = { role: "user", content: [{ type: "text", text: indexMessage(DIR, "") }] };
  const body = { messages: [prompt("1"), snapshot, { role: "assistant", content: "done" }, prompt("2")] };
  expect(stripIndexSnapshot("/v1/messages", body, DIR)).toEqual({ body, found: false });
});

test("messages: model input is system text, message text, tool inputs and tool results", () => {
  const body = {
    model: "claude-haiku-4.5",
    max_tokens: 8192,
    stream: true,
    thinking: { type: "enabled", budget_tokens: 1024 },
    system: [{ type: "text", text: "You are Copilot.", cache_control: { type: "ephemeral" } }],
    tools: [{ name: "view", description: "View a file", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: [{ type: "text", text: "<current_datetime>T</current_datetime>\n\nRead nonce.txt" }] },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Reading it.", signature: "EoEECuUC" },
          { type: "tool_use", id: "toolu_01", name: "view", input: { path: "/w/nonce.txt" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "NONCE-1\n" }] },
      { role: "assistant", content: "It is not empty." },
    ],
  };
  expect(modelInputText("/v1/messages", body)).toBe(
    'You are Copilot.\n<current_datetime>T</current_datetime>\n\nRead nonce.txt\n{"path":"/w/nonce.txt"}\nNONCE-1\n\nIt is not empty.',
  );
});

test("responses: model input is instructions, message text, call arguments, custom inputs and outputs", () => {
  const body = {
    model: "gpt-6.1-sol",
    instructions: "Rules.",
    input: [
      { type: "message", role: "system", content: [{ type: "input_text", text: "You are Copilot." }] },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "<current_datetime>T</current_datetime>\n\nRead nonce.txt" }],
      },
      { type: "reasoning", id: "rs_1", encrypted_content: "gAAAAB", summary: [] },
      {
        type: "function_call",
        id: "fc_call_1",
        call_id: "call_1",
        name: "view",
        arguments: '{"path":"/w/nonce.txt"}',
        status: "completed",
      },
      { type: "function_call_output", call_id: "call_1", output: "NONCE-1\n" },
      { type: "custom_tool_call", id: "ctc_call_2", call_id: "call_2", name: "apply_patch", input: "*** Begin Patch\n*** End Patch\n" },
      { type: "custom_tool_call_output", call_id: "call_2", output: "Added 1 file(s): /f/INDEX.md" },
      {
        type: "message",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", text: "It is not empty.", annotations: [] }],
      },
    ],
    tools: [{ type: "function", name: "view", parameters: {} }],
    reasoning: { effort: "medium", summary: "auto" },
    store: false,
    stream: true,
  };
  expect(modelInputText("/responses", body)).toBe(
    'Rules.\nYou are Copilot.\n<current_datetime>T</current_datetime>\n\nRead nonce.txt\n{"path":"/w/nonce.txt"}\nNONCE-1\n\n*** Begin Patch\n*** End Patch\n\nAdded 1 file(s): /f/INDEX.md\nIt is not empty.',
  );
});

test("an input item of an unknown type fails loudly", () => {
  expect(() => modelInputText("/responses", { input: [{ type: "compaction", encrypted_content: "x" }] })).toThrow(
    'input[0] has unrecognized type "compaction"',
  );
});
