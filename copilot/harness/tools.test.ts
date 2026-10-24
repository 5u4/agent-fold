import { describe, expect, test } from "bun:test";
import { classify } from "./tools";

const repo = "/private/tmp/cst.KgJO/repo";

describe("classify Claude tools", () => {
  test("view reads the path", () => {
    expect(classify("view", { path: `${repo}/notes.txt` })).toEqual({ kind: "read", path: `${repo}/notes.txt` });
  });

  test("grep and glob search", () => {
    expect(classify("grep", { pattern: "NEEDLE", paths: repo })).toEqual({ kind: "search" });
    expect(classify("glob", { paths: repo, pattern: "**/*.py" })).toEqual({ kind: "search" });
  });

  test("create writes file_text as content", () => {
    expect(classify("create", { path: `${repo}/out.txt`, file_text: "hello\n" })).toEqual({
      kind: "write",
      path: `${repo}/out.txt`,
      content: "hello\n",
    });
  });

  test("edit carries no whole-file content, so it is other", () => {
    expect(classify("edit", { path: `${repo}/app.py`, old_str: "    return 1", new_str: "    return 2" })).toEqual({ kind: "other" });
  });

  test("bash runs the command", () => {
    expect(classify("bash", { command: "git status --short", description: "Show short git status" })).toEqual({
      kind: "shell",
      command: "git status --short",
    });
  });

  test("str_replace_editor dispatches on command", () => {
    expect(classify("str_replace_editor", { command: "view", path: "a.ts" })).toEqual({ kind: "read", path: "a.ts" });
    expect(classify("str_replace_editor", { command: "create", path: "b.ts", file_text: "x\n" })).toEqual({
      kind: "write",
      path: "b.ts",
      content: "x\n",
    });
    expect(classify("str_replace_editor", { command: "insert", path: "c.ts", insert_line: 2, new_str: "y" })).toEqual({ kind: "other" });
  });
});

describe("classify GPT tools", () => {
  test("rg and semantic_code_search search", () => {
    expect(classify("rg", { pattern: "NEEDLE", output_mode: "content" })).toEqual({ kind: "search" });
    expect(classify("semantic_code_search", { query: "retry policy", repo: "o/r" })).toEqual({ kind: "search" });
  });

  test("apply_patch adding one file writes it with the added lines", () => {
    expect(classify("apply_patch", { input: `*** Begin Patch\n*** Add File: ${repo}/out.txt\n+hello\n*** End Patch\n` })).toEqual({
      kind: "write",
      path: `${repo}/out.txt`,
      content: "hello\n",
    });
  });

  test("apply_patch updating a file is other", () => {
    expect(
      classify("apply_patch", {
        input: `*** Begin Patch\n*** Update File: ${repo}/app.py\n@@\n-    return 1\n+    return 2\n*** End Patch\n`,
      }),
    ).toEqual({ kind: "other" });
  });

  test("apply_patch touching several files is other, even when the first adds a file", () => {
    const patch = ["*** Begin Patch", "*** Add File: notes/a.md", "+# A", "*** Delete File: tmp.txt", "*** End Patch"].join("\n");
    expect(classify("apply_patch", { input: patch })).toEqual({ kind: "other" });
  });
});

describe("classify fallbacks and errors", () => {
  test("shell session tools and unknown tools are other", () => {
    expect(classify("read_bash", { shellId: "0" })).toEqual({ kind: "other" });
    expect(classify("constructor", {})).toEqual({ kind: "other" });
  });

  test("a known tool without its required field throws naming tool and field", () => {
    expect(() => classify("view", { file: "a.ts" })).toThrow('view: missing string field "path"');
    expect(() => classify("create", { path: "a.ts" })).toThrow('create: missing string field "file_text"');
    expect(() => classify("apply_patch", { patch: "x" })).toThrow('apply_patch: missing string field "input"');
    expect(() => classify("str_replace_editor", { command: "undo_edit", path: "a.ts" })).toThrow(
      'str_replace_editor: unrecognized field "command" value "undo_edit"',
    );
  });
});
