import type { Call } from "@agent-fold/evals";

type Classifier = (args: Record<string, unknown>, name: string) => Call;

function stringField(name: string, args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string") throw new Error(`${name}: missing string field "${key}"`);
  return value;
}

const read: Classifier = (args, name) => ({ kind: "read", path: stringField(name, args, "path") });
const search: Classifier = () => ({ kind: "search" });
const other: Classifier = () => ({ kind: "other" });
const create: Classifier = (args, name) => ({
  kind: "write",
  path: stringField(name, args, "path"),
  content: stringField(name, args, "file_text"),
});
const shell: Classifier = (args, name) => ({ kind: "shell", command: stringField(name, args, "command") });

const editorCommands: Record<string, Classifier> = { view: read, create, str_replace: other, insert: other };

const strReplaceEditor: Classifier = (args, name) => {
  const command = stringField(name, args, "command");
  if (!Object.hasOwn(editorCommands, command)) throw new Error(`${name}: unrecognized field "command" value "${command}"`);
  return editorCommands[command](args, name);
};

const fileHeader = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/;

function applyPatch(patch: string): Call {
  const headers: { op: string; path: string }[] = [];
  let content = "";
  for (const line of patch.split("\n")) {
    const header = fileHeader.exec(line);
    if (header) headers.push({ op: header[1], path: header[2] });
    else if (headers.length === 1 && line.startsWith("+")) content += `${line.slice(1)}\n`;
  }
  return headers.length === 1 && headers[0].op === "Add File" ? { kind: "write", path: headers[0].path, content } : { kind: "other" };
}

const classifiers: Record<string, Classifier> = {
  view: read,
  str_replace_editor: strReplaceEditor,
  grep: search,
  rg: search,
  glob: search,
  semantic_code_search: search,
  create,
  edit: other,
  str_replace: other,
  bash: shell,
  powershell: shell,
};

export const FREEFORM_INPUT_KEY = "input";

export function classify(name: string, args: Record<string, unknown>): Call {
  if (name === "apply_patch") return applyPatch(stringField(name, args, FREEFORM_INPUT_KEY));
  return Object.hasOwn(classifiers, name) ? classifiers[name](args, name) : { kind: "other" };
}
