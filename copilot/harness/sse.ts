import type { ModelPath } from "./model-input";
import type { ScriptedOutput } from "./script";

type Event = { type: string; [field: string]: unknown };

const usage = { input_tokens: 10, output_tokens: 5 };

function scriptedId(): string {
  return `scripted${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function anthropicEvents(model: string, output: ScriptedOutput): Event[] {
  if (output.kind === "custom") throw new Error(`/v1/messages cannot carry the custom tool call ${output.name}`);
  const message = {
    id: `msg_${scriptedId()}`,
    type: "message",
    role: "assistant",
    model,
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage,
  };
  const [block, delta, stopReason] =
    output.kind === "call"
      ? [
          { type: "tool_use", id: `toolu_${scriptedId()}`, name: output.name, input: {} },
          { type: "input_json_delta", partial_json: JSON.stringify(output.input) },
          "tool_use",
        ]
      : [{ type: "text", text: "" }, { type: "text_delta", text: output.text }, "end_turn"];
  return [
    { type: "message_start", message },
    { type: "content_block_start", index: 0, content_block: block },
    { type: "content_block_delta", index: 0, delta },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage },
    { type: "message_stop" },
  ];
}

function responsesItemEvents(output: ScriptedOutput): { item: Record<string, unknown>; added: Record<string, unknown>; events: Event[] } {
  const callId = `call_${scriptedId()}`;
  switch (output.kind) {
    case "call": {
      const id = `fc_${callId}`;
      const args = JSON.stringify(output.input);
      const item = { type: "function_call", id, call_id: callId, name: output.name, arguments: args, status: "completed" };
      return {
        item,
        added: { ...item, arguments: "", status: "in_progress" },
        events: [
          { type: "response.function_call_arguments.delta", item_id: id, output_index: 0, delta: args },
          { type: "response.function_call_arguments.done", item_id: id, output_index: 0, arguments: args },
        ],
      };
    }
    case "custom": {
      const id = `ctc_${callId}`;
      const item = { type: "custom_tool_call", id, call_id: callId, name: output.name, input: output.input, status: "completed" };
      return {
        item,
        added: { ...item, input: "", status: "in_progress" },
        events: [
          { type: "response.custom_tool_call_input.delta", item_id: id, output_index: 0, delta: output.input },
          { type: "response.custom_tool_call_input.done", item_id: id, output_index: 0, input: output.input },
        ],
      };
    }
    case "text": {
      const id = `msg_${scriptedId()}`;
      const part = { type: "output_text", text: output.text, annotations: [] };
      const item = { type: "message", id, role: "assistant", status: "completed", phase: "final_answer", content: [part] };
      const at = { item_id: id, output_index: 0, content_index: 0 };
      return {
        item,
        added: { ...item, status: "in_progress", content: [] },
        events: [
          { type: "response.content_part.added", ...at, part: { ...part, text: "" } },
          { type: "response.output_text.delta", ...at, delta: output.text },
          { type: "response.output_text.done", ...at, text: output.text },
          { type: "response.content_part.done", ...at, part },
        ],
      };
    }
  }
}

function responsesEvents(model: string, output: ScriptedOutput): Event[] {
  const response = {
    id: `resp_${scriptedId()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    status: "in_progress",
    output: [],
  };
  const { item, added, events } = responsesItemEvents(output);
  const completedUsage = {
    ...usage,
    total_tokens: 15,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 },
  };
  return [
    { type: "response.created", response },
    { type: "response.output_item.added", output_index: 0, item: added },
    ...events,
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { ...response, status: "completed", output: [item], usage: completedUsage } },
  ].map((event, sequence_number) => ({ ...event, sequence_number }));
}

const EVENTS: Record<ModelPath, (model: string, output: ScriptedOutput) => Event[]> = {
  "/v1/messages": anthropicEvents,
  "/responses": responsesEvents,
};

export function scriptedResponse(path: ModelPath, model: string, output: ScriptedOutput): Response {
  const body = EVENTS[path](model, output)
    .map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}
