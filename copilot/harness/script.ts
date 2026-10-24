import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { JsonObject } from "../fold";
import type { ModelPath } from "./model-input";
import { FOLD_DIR, type ScriptStep } from "./types";

export type ToolKind = "call" | "custom";

type ScriptedCall = { kind: "call"; name: string; input: JsonObject } | { kind: "custom"; name: string; input: string };

export type ScriptedOutput = ScriptedCall | { kind: "text"; text: string };

export type ScriptContext = { tools: ReadonlyMap<string, ToolKind>; workdir: string; foldDir: string };

const RESPONSES_TOOL_KINDS: Record<string, ToolKind> = { function: "call", custom: "custom" };

export function offeredTools(path: ModelPath, body: JsonObject): Map<string, ToolKind> {
  const tools = body.tools ?? [];
  if (!Array.isArray(tools)) throw new Error(`${path} request body tools is not a list`);
  const offered = new Map<string, ToolKind>();
  for (const [index, tool] of tools.entries()) {
    const kind = path === "/v1/messages" ? "call" : RESPONSES_TOOL_KINDS[tool?.type];
    if (kind === undefined) continue;
    if (typeof tool.name !== "string") throw new Error(`${path} request body tools[${index}].name is not a string`);
    offered.set(tool.name, kind);
  }
  return offered;
}

function addFilePatch(path: string, content: string): string {
  const lines = content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
  return `*** Begin Patch\n*** Add File: ${path}\n${lines.map(line => `+${line}\n`).join("")}*** End Patch\n`;
}

function candidates(step: Exclude<ScriptStep, { reply: string }>, workdir: string, fill: (text: string) => string): ScriptedCall[] {
  switch (step.kind) {
    case "read":
      return [{ kind: "call", name: "view", input: { path: resolve(workdir, fill(step.path)) } }];
    case "shell": {
      const command = fill(step.command);
      return [{ kind: "call", name: "bash", input: { command, description: `Run ${command}` } }];
    }
    case "write": {
      const path = resolve(workdir, fill(step.path));
      if (existsSync(path)) throw new Error(`script step ${JSON.stringify(step)} writes ${path}, which already exists`);
      const content = fill(step.content);
      return [
        { kind: "call", name: "create", input: { path, file_text: content } },
        { kind: "custom", name: "apply_patch", input: addFilePatch(path, content) },
      ];
    }
  }
}

export function translateStep(step: ScriptStep, { tools, workdir, foldDir }: ScriptContext): ScriptedOutput {
  const fill = (text: string) => text.replaceAll(FOLD_DIR, foldDir);
  if ("reply" in step) return { kind: "text", text: fill(step.reply) };
  const options = candidates(step, workdir, fill);
  const chosen = options.find(option => tools.get(option.name) === option.kind);
  if (chosen !== undefined) return chosen;
  const wanted = options.map(option => `${option.name} (${option.kind})`).join(", ");
  throw new Error(`script step ${JSON.stringify(step)} needs one of ${wanted}; the request offered ${[...tools.keys()].join(", ")}`);
}
