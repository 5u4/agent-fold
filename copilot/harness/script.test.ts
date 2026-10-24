import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { offeredTools, translateStep } from "./script";
import { FOLD_DIR } from "./types";

const claudeTools = offeredTools("/v1/messages", {
  model: "claude-haiku-4.5",
  tools: [
    { name: "bash", description: "Run a command", input_schema: { type: "object" } },
    { name: "view", description: "View a file", input_schema: { type: "object" } },
    { name: "create", description: "Create a file", input_schema: { type: "object" } },
  ],
});

const gptTools = offeredTools("/responses", {
  model: "gpt-6.1-sol",
  tools: [
    { type: "function", name: "bash", parameters: { type: "object" } },
    { type: "custom", name: "apply_patch", format: { type: "grammar", syntax: "lark", definition: "start: begin_patch hunk+ end_patch" } },
    { type: "function", name: "view", parameters: { type: "object" } },
    { type: "web_search" },
  ],
});

const scratch = mkdtempSync(join(tmpdir(), "script-test-"));

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

test("offered tools keep the name and whether the API calls them with JSON or freeform input", () => {
  expect([...claudeTools]).toEqual([
    ["bash", "call"],
    ["view", "call"],
    ["create", "call"],
  ]);
  expect([...gptTools]).toEqual([
    ["bash", "call"],
    ["apply_patch", "custom"],
    ["view", "call"],
  ]);
});

test("a Claude-family request gets view, bash and create with absolute paths and the fold dir filled in", () => {
  const ctx = { tools: claudeTools, workdir: "/work", foldDir: "/fold/s1" };
  expect(translateStep({ kind: "read", path: "config/defaults.yaml" }, ctx)).toEqual({
    kind: "call",
    name: "view",
    input: { path: "/work/config/defaults.yaml" },
  });
  expect(translateStep({ kind: "shell", command: "bin/config production" }, ctx)).toEqual({
    kind: "call",
    name: "bash",
    input: { command: "bin/config production", description: "Run bin/config production" },
  });
  expect(translateStep({ kind: "write", path: `${FOLD_DIR}/INDEX.md`, content: `- ${FOLD_DIR}/retries.md: retries\n` }, ctx)).toEqual({
    kind: "call",
    name: "create",
    input: { path: "/fold/s1/INDEX.md", file_text: "- /fold/s1/retries.md: retries\n" },
  });
  expect(translateStep({ reply: `Notes are in ${FOLD_DIR}.` }, ctx)).toEqual({ kind: "text", text: "Notes are in /fold/s1." });
});

test("a GPT-family request writes through an apply_patch Add File patch", () => {
  const ctx = { tools: gptTools, workdir: "/work", foldDir: "/fold/s1" };
  expect(
    translateStep({ kind: "write", path: `${FOLD_DIR}/retries.md`, content: "# Retries\n\nFrom deploy/production.env\n" }, ctx),
  ).toEqual({
    kind: "custom",
    name: "apply_patch",
    input: "*** Begin Patch\n*** Add File: /fold/s1/retries.md\n+# Retries\n+\n+From deploy/production.env\n*** End Patch\n",
  });
});

test("a step no offered tool can carry names the step and the offered tools", () => {
  const ctx = { tools: new Map([["view", "call" as const]]), workdir: "/work", foldDir: "/fold/s1" };
  expect(() => translateStep({ kind: "shell", command: "ls" }, ctx)).toThrow(
    'script step {"kind":"shell","command":"ls"} needs one of bash (call); the request offered view',
  );
});

test("apply_patch offered as a JSON function does not count as the freeform tool", () => {
  const ctx = { tools: new Map([["apply_patch", "call" as const]]), workdir: "/work", foldDir: "/fold/s1" };
  expect(() => translateStep({ kind: "write", path: "a.txt", content: "a\n" }, ctx)).toThrow(
    'script step {"kind":"write","path":"a.txt","content":"a\\n"} needs one of create (call), apply_patch (custom); the request offered apply_patch',
  );
});

test("a write onto an existing file is refused", () => {
  writeFileSync(join(scratch, "taken.txt"), "old\n");
  const ctx = { tools: claudeTools, workdir: scratch, foldDir: "/fold/s1" };
  expect(() => translateStep({ kind: "write", path: "taken.txt", content: "new\n" }, ctx)).toThrow(
    `script step {"kind":"write","path":"taken.txt","content":"new\\n"} writes ${join(scratch, "taken.txt")}, which already exists`,
  );
});
