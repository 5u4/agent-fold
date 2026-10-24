import type { ActionBody } from "./types";

type Classifier = (input: unknown, name: string) => ActionBody[];

function stringField(name: string, input: unknown, key: string): string {
  const value = typeof input === "object" && input !== null ? (input as Record<string, unknown>)[key] : undefined;
  if (typeof value !== "string") throw new Error(`${name}: missing string field "${key}"`);
  return value;
}

const read: Classifier = (input, name) => [{ kind: "read", path: stringField(name, input, "path") }];
const searchBy =
  (key: string): Classifier =>
  (input, name) => [{ kind: "search", pattern: stringField(name, input, key) }];
const create: Classifier = (input, name) => [
  { kind: "write", path: stringField(name, input, "path"), content: stringField(name, input, "file_text") },
];
const edit: Classifier = (input, name) => [{ kind: "write", path: stringField(name, input, "path") }];
const shell: Classifier = (input, name) => [{ kind: "shell", command: stringField(name, input, "command") }];

const editorCommands: Record<string, Classifier> = { view: read, create, str_replace: edit, insert: edit };

const strReplaceEditor: Classifier = (input, name) => {
  const command = stringField(name, input, "command");
  if (!Object.hasOwn(editorCommands, command)) throw new Error(`${name}: unrecognized field "command" value "${command}"`);
  return editorCommands[command](input, name);
};

const fileHeader = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/;

const applyPatch: Classifier = (input, name) => {
  if (typeof input !== "string") throw new Error(`${name}: input is not a string patch`);
  const writes: ActionBody[] = [];
  let added: { kind: "write"; path: string; content: string } | undefined;
  for (const line of input.split("\n")) {
    const header = fileHeader.exec(line);
    if (header) {
      added = header[1] === "Add File" ? { kind: "write", path: header[2], content: "" } : undefined;
      writes.push(added ?? { kind: "write", path: header[2] });
    } else if (line.startsWith("*** ")) {
      added = undefined;
    } else if (added && line.startsWith("+")) {
      added.content += `${line.slice(1)}\n`;
    }
  }
  if (writes.length === 0) throw new Error(`${name}: patch has no file header`);
  return writes;
};

const classifiers: Record<string, Classifier> = {
  view: read,
  str_replace_editor: strReplaceEditor,
  grep: searchBy("pattern"),
  rg: searchBy("pattern"),
  glob: searchBy("pattern"),
  semantic_code_search: searchBy("query"),
  create,
  edit,
  str_replace: edit,
  apply_patch: applyPatch,
  bash: shell,
  powershell: shell,
};

export function classify(name: string, input: unknown): ActionBody[] {
  return Object.hasOwn(classifiers, name) ? classifiers[name](input, name) : [{ kind: "other", name, input }];
}
