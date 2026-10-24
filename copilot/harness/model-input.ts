import type { JsonObject } from "../fold";
import { formats } from "../formats";
import { indexHeading } from "../session-index";

export type ModelPath = "/v1/messages" | "/responses";

const MODEL_PATHS: Record<string, true> = { "/v1/messages": true, "/responses": true };

export function isModelPath(path: string): path is ModelPath {
  return MODEL_PATHS[path] === true;
}

export function stripIndexSnapshot(path: ModelPath, body: JsonObject, foldDir: string): { body: JsonObject; found: boolean } {
  const format = formats[path];
  const items = format.items(body);
  if (items === undefined) throw new Error(`${path} request body has no ${ITEMS_FIELD[path]} list`);
  const at = items.map(item => format.classify(item)).lastIndexOf("boundary") + 1;
  const candidate = items[at];
  const text = at > 0 && candidate !== undefined ? format.runKey(candidate) : "";
  const found = text.startsWith(indexHeading(foldDir)) && Bun.deepEquals(candidate, format.indexItem(text));
  return found ? { body: format.withItems(body, items.toSpliced(at, 1)), found } : { body, found };
}

const ITEMS_FIELD: Record<ModelPath, string> = { "/v1/messages": "messages", "/responses": "input" };

type Texts = (node: JsonObject, where: string) => string[];

function string(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where} is not a string`);
  return value;
}

function list(value: unknown, where: string): JsonObject[] {
  if (!Array.isArray(value)) throw new Error(`${where} is not a list`);
  return value;
}

function byType(table: Record<string, Texts>, nodes: JsonObject[], where: string, defaultType?: string): string[] {
  return nodes.flatMap((node, index) => {
    const type = node.type ?? defaultType;
    const texts = typeof type === "string" ? table[type] : undefined;
    if (texts === undefined) throw new Error(`${where}[${index}] has unrecognized type ${JSON.stringify(type)}`);
    return texts(node, `${where}[${index}]`);
  });
}

function stringOr(table: Record<string, Texts>, value: unknown, where: string): string[] {
  if (value === undefined) return [];
  return typeof value === "string" ? [value] : byType(table, list(value, where), where);
}

const MESSAGES_TOOL_RESULT_BLOCKS: Record<string, Texts> = {
  text: (block, where) => [string(block.text, `${where}.text`)],
  image: () => [],
};

const MESSAGES_BLOCKS: Record<string, Texts> = {
  ...MESSAGES_TOOL_RESULT_BLOCKS,
  tool_use: (block, where) => {
    if (block.input === undefined) throw new Error(`${where}.input is missing`);
    return [JSON.stringify(block.input)];
  },
  tool_result: (block, where) => stringOr(MESSAGES_TOOL_RESULT_BLOCKS, block.content, `${where}.content`),
  thinking: () => [],
  redacted_thinking: () => [],
};

const RESPONSES_PARTS: Record<string, Texts> = {
  input_text: (part, where) => [string(part.text, `${where}.text`)],
  output_text: (part, where) => [string(part.text, `${where}.text`)],
  input_image: () => [],
};

const RESPONSES_ITEMS: Record<string, Texts> = {
  message: (item, where) => stringOr(RESPONSES_PARTS, item.content, `${where}.content`),
  function_call: (item, where) => [string(item.arguments, `${where}.arguments`)],
  function_call_output: (item, where) => stringOr(RESPONSES_PARTS, item.output, `${where}.output`),
  custom_tool_call: (item, where) => [string(item.input, `${where}.input`)],
  custom_tool_call_output: (item, where) => stringOr(RESPONSES_PARTS, item.output, `${where}.output`),
  reasoning: () => [],
};

const MODEL_INPUT: Record<ModelPath, (body: JsonObject) => string[]> = {
  "/v1/messages": body => [
    ...stringOr(MESSAGES_TOOL_RESULT_BLOCKS, body.system, "system"),
    ...list(body.messages, "messages").flatMap((message, index) =>
      stringOr(MESSAGES_BLOCKS, message.content, `messages[${index}].content`),
    ),
  ],
  "/responses": body => [
    ...(body.instructions === undefined ? [] : [string(body.instructions, "instructions")]),
    ...byType(RESPONSES_ITEMS, list(body.input, "input"), "input", "message"),
  ],
};

export function modelInputText(path: ModelPath, body: JsonObject): string {
  return MODEL_INPUT[path](body).join("\n");
}
