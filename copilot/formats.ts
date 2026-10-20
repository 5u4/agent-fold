import { type Format, type JsonObject, startsRun } from "./fold";

type Part = { type: string; text?: string };

type ResponsesItem = { type?: string; role?: string; content?: string | Part[] };

type Message = { role: string; content: string | Part[] };

const RESPONSES_DROP: Record<string, true> = {
  reasoning: true,
  function_call: true,
  function_call_output: true,
  custom_tool_call: true,
  custom_tool_call_output: true,
};

const STRIPPED_IN_FOLD: Record<string, true> = { thinking: true, redacted_thinking: true, tool_result: true };

function parts(content: string | Part[] | undefined): Part[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : (content ?? []);
}

function texts(content: string | Part[] | undefined): string[] {
  return parts(content).flatMap(part => (typeof part.text === "string" ? [part.text] : []));
}

function isBoundary(content: string | Part[] | undefined): boolean {
  return texts(content).some(startsRun);
}

function hasText(content: string | Part[] | undefined): boolean {
  return texts(content).some(text => text.trim() !== "");
}

function arrayAt<Item>(body: JsonObject, key: string): Item[] | undefined {
  const value = body[key];
  return Array.isArray(value) ? (value as Item[]) : undefined;
}

export const responses: Format<ResponsesItem> = {
  items: body => arrayAt(body, "input"),
  withItems: (body, input) => ({ ...body, input }),
  classify(item) {
    if (item.type !== undefined && item.type !== "message") return RESPONSES_DROP[item.type] === true ? "drop" : "keep";
    if (item.role === "user") return isBoundary(item.content) ? "boundary" : "steering";
    if (item.role === "assistant") return hasText(item.content) ? "reply" : "drop";
    return "keep";
  },
  keptInFold: item => item,
  withRules(body, rules) {
    if (typeof body.instructions === "string") return { ...body, instructions: `${body.instructions}\n\n${rules}` };
    const input = arrayAt<ResponsesItem>(body, "input") ?? [];
    const [first, ...rest] = input;
    if (first?.role !== "system") return { ...body, instructions: rules };
    const content =
      typeof first.content === "string" ? `${first.content}\n\n${rules}` : [...(first.content ?? []), { type: "input_text", text: rules }];
    return { ...body, input: [{ ...first, content }, ...rest] };
  },
  indexItem: text => ({ type: "message", role: "user", content: [{ type: "input_text", text }] }),
  runKey: item => texts(item.content).join("\n"),
};

export const messages: Format<Message> = {
  items: body => arrayAt(body, "messages"),
  withItems: (body, messages) => ({ ...body, messages }),
  classify(message) {
    const blocks = parts(message.content);
    if (message.role === "user") {
      const toolResults = blocks.filter(block => block.type === "tool_result").length;
      if (toolResults === 0) return isBoundary(message.content) ? "boundary" : "steering";
      return toolResults === blocks.length ? "drop" : "steering";
    }
    if (message.role === "assistant") {
      return blocks.some(block => block.type === "tool_use") || !hasText(message.content) ? "drop" : "reply";
    }
    return "keep";
  },
  keptInFold(message) {
    if (typeof message.content === "string") return message;
    const content = message.content.filter(block => STRIPPED_IN_FOLD[block.type] !== true);
    return content.length === 0 ? undefined : { ...message, content };
  },
  withRules(body, rules) {
    const system = body.system;
    if (typeof system === "string") return { ...body, system: `${system}\n\n${rules}` };
    return { ...body, system: [...(Array.isArray(system) ? system : []), { type: "text", text: rules }] };
  },
  indexItem: text => ({ role: "user", content: [{ type: "text", text }] }),
  runKey: message => texts(message.content).join("\n"),
};

export const formats: Record<string, Format<object>> = { "/responses": responses, "/v1/messages": messages };
