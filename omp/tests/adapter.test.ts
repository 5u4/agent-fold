import { expect, test } from "bun:test";
import { realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FOLD_DIR, type Run, type Scenario, type ScriptStep } from "@agent-fold/evals";
import { ompHarness, scriptReplies, transcriptRun } from "../harness/adapter";
import { runTrial } from "../harness/run-omp";
import type { Run as OmpRun } from "../harness/types";
import { INDEX_HEADER } from "../session-index";

let setupWorkdir = "";

const scenario: Scenario<void> = {
  title: "adapter",
  async setup(workdir) {
    setupWorkdir = workdir;
    expect(realpathSync(workdir)).toBe(workdir);
    writeFileSync(join(workdir, "nonce.txt"), "NONCE-read\n");
  },
  turns: [
    {
      prompt: "q1",
      script: [
        { kind: "read", path: "nonce.txt" },
        { kind: "shell", command: "echo NONCE-shell" },
        { kind: "shell", command: "exit 3" },
        { kind: "write", path: `${FOLD_DIR}/INDEX.md`, content: "- NONCE-index\n" },
        { kind: "read", path: "xd://grep" },
        { kind: "reply", text: "done 1" },
      ],
    },
    { prompt: "q2", script: [{ kind: "reply", text: "done 2" }] },
  ],
  grade: () => ({ status: "pass", evidence: "" }),
  metrics: () => ({}),
};

test("the omp harness turns a scripted with-plugin run into a normalized transcript", async () => {
  const outcome = await ompHarness.runTrial(scenario, { variant: "with-plugin", model: "scripted/scripted" });
  if (!("run" in outcome)) throw new Error(outcome.unsupported);
  const run: Run = outcome.run;
  const [first, second] = run.turns;
  expect(first.actions.map(({ kind, name }) => [kind, name])).toEqual([
    ["read", "read"],
    ["shell", "bash"],
    ["shell", "bash"],
    ["write", "write"],
    ["search", "read"],
  ]);
  const [read, echo, exit, write, search] = first.actions;
  expect(read).toMatchObject({ path: "nonce.txt", isError: false, touchesSessionLog: false });
  expect(read.result).toContain("NONCE-read");
  expect(echo).toMatchObject({ command: "echo NONCE-shell", isError: false });
  expect(echo.result).toContain("NONCE-shell");
  expect(echo.result).not.toContain("NONCE-read");
  expect(exit).toMatchObject({ command: "exit 3", isError: true });
  expect(write).toMatchObject({ content: "- NONCE-index\n" });
  expect(write.kind === "write" && write.path.startsWith(`${run.foldHome}/`)).toBe(true);
  expect(write.kind === "write" && write.path.endsWith("/INDEX.md")).toBe(true);
  expect(search.args).toEqual({ path: "xd://grep" });
  expect(first.reply.trim()).toBe("done 1");
  expect(second).toMatchObject({ prompt: "q2", actions: [] });
  expect(second.reply.trim()).toBe("done 2");
  expect(second.modelInputs).toHaveLength(1);
  expect(second.modelInputs[0]).toContain("q2");
  expect(second.modelInputs[0]).not.toContain(INDEX_HEADER);
  expect(run.foldHome.startsWith(`${dirname(setupWorkdir)}/`)).toBe(true);
}, 180_000);

test("modelInputs drop the INDEX snapshot that the raw request carried", async () => {
  const { run } = await runTrial(
    {
      async setup() {},
      turns: [
        {
          prompt: "q1",
          script: scriptReplies([
            { kind: "write", path: `${FOLD_DIR}/INDEX.md`, content: "- NONCE-index\n" },
            { kind: "reply", text: "done 1" },
          ]),
        },
        { prompt: "q2", script: scriptReplies([{ kind: "reply", text: "done 2" }]) },
      ],
    },
    { variant: "with-plugin", model: "scripted/scripted" },
  );
  const raw = JSON.stringify(run.turns[1].requests[0]);
  expect(raw).toContain(INDEX_HEADER);
  expect(raw).toContain("NONCE-index");
  const [input] = transcriptRun(run).turns[1].modelInputs;
  expect(input).not.toContain(INDEX_HEADER);
  expect(input).not.toContain("NONCE-index");
}, 180_000);

test("a tool result with no matching tool call fails the transcript", () => {
  const run = {
    variant: "with-plugin",
    foldHome: "/fold-home",
    turns: [
      {
        prompt: "q1",
        stdout: "done",
        requests: [],
        entries: [],
        messages: [
          { role: "toolResult", toolCallId: "call-missing", toolName: "read", content: [], isError: false, timestamp: 0 },
        ],
      },
    ],
  } as unknown as OmpRun;
  expect(() => transcriptRun(run)).toThrow("turn 1 has a tool result call-missing with no matching tool call");
});

function writeTwice(path: string): Scenario<void> {
  const write: ScriptStep = { kind: "write", path, content: "x\n" };
  return {
    title: "write twice",
    async setup(workdir) {
      writeFileSync(join(workdir, "nonce.txt"), "NONCE-read\n");
    },
    turns: [{ prompt: "q1", script: [write, write, { kind: "reply", text: "done" }] }],
    grade: () => ({ status: "pass", evidence: "" }),
    metrics: () => ({}),
  };
}

test("a scripted write onto an existing file fails the trial", async () => {
  await expect(
    ompHarness.runTrial(writeTwice("nonce.txt"), { variant: "with-plugin", model: "scripted/scripted" }),
  ).rejects.toThrow("scripted write target already exists: nonce.txt");
}, 180_000);

test("a scripted write onto a scratch file written earlier fails the trial", async () => {
  await expect(
    ompHarness.runTrial(writeTwice(`${FOLD_DIR}/note.md`), { variant: "without-plugin", model: "scripted/scripted" }),
  ).rejects.toThrow("scripted write target already exists: local://note.md");
}, 180_000);
