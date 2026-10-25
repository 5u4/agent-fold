import { expect, test } from "bun:test";
import { readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { FOLD_DIR, type Run, type Scenario, scenarios } from "@agent-fold/evals";
import { INDEX_HEADER } from "../session-index";
import { piHarness } from "../harness/adapter";
import { selectScenarios } from "../evals/eval";

type State = { workdir: string; notes: string[] };

function scenario(setupFiles: Record<string, string> = {}): Scenario<State> {
  return {
    title: "scripted",
    turns: [
      {
        prompt: "q1",
        script: [
          { kind: "read", path: "a.txt" },
          { kind: "shell", command: "echo shell-out" },
          { kind: "read", path: "missing.txt" },
          { kind: "write", path: `${FOLD_DIR}/x.md`, content: "note" },
          { kind: "reply", text: "done 1" },
        ],
      },
      { prompt: "q2", script: [{ kind: "reply", text: "done 2" }] },
    ],
    async setup(workdir) {
      writeFileSync(join(workdir, "a.txt"), "A-CONTENT\n");
      for (const [name, text] of Object.entries(setupFiles)) writeFileSync(join(workdir, name), text);
      return { workdir, notes: [] };
    },
    async inspect(workdir, state) {
      const root = dirname(workdir);
      const notes = readdirSync(root, { recursive: true, encoding: "utf8" })
        .filter(path => path.endsWith("x.md"))
        .map(path => `${join(root, path)}:${readFileSync(join(root, path), "utf8")}`);
      return { ...state, notes };
    },
    grade: () => ({ status: "pass", evidence: "" }),
    metrics: () => ({}),
  };
}

async function trial(variant: "with-plugin" | "without-plugin"): Promise<{ run: Run; state: State }> {
  const outcome = await piHarness.runTrial(scenario(), { variant, model: "unused" });
  if (!("run" in outcome)) throw new Error("trial was unsupported");
  return outcome;
}

test("with the plugin, scripted turns produce a normalized transcript and write into the fold dir", async () => {
  const { run, state } = await trial("with-plugin");
  expect(state.workdir.startsWith(`${realpathSync(tmpdir())}/`)).toBe(true);
  expect(run.foldHome).toBe(join(dirname(state.workdir), "fold-home"));
  expect(run.variant).toBe("with-plugin");
  expect(run.turns.map(turn => [turn.prompt, turn.reply])).toEqual([
    ["q1", "done 1"],
    ["q2", "done 2"],
  ]);
  const [first, second] = run.turns;
  expect(first.actions.map(action => [action.kind, action.name, action.isError])).toEqual([
    ["read", "read", false],
    ["shell", "bash", false],
    ["read", "read", true],
    ["write", "write", false],
  ]);
  expect(first.actions[0]).toMatchObject({ path: "a.txt", result: "A-CONTENT\n" });
  expect(first.actions[1]).toMatchObject({ command: "echo shell-out", touchesSessionLog: false });
  expect(first.actions[1].result).toContain("shell-out");
  const writePath = String(first.actions[3].args.path);
  expect(writePath.startsWith(`${run.foldHome}/`)).toBe(true);
  expect(state.notes).toEqual([`${writePath}:note`]);
  expect(second.actions).toEqual([]);
  expect(first.modelInputs.length).toBe(5);
  expect(first.modelInputs[1]).toContain("A-CONTENT");
  expect(first.modelInputs[2]).toContain("shell-out");
  for (const input of [...first.modelInputs, ...second.modelInputs]) expect(input).not.toContain(INDEX_HEADER);
}, 120_000);

test("without the plugin, the fold dir placeholder resolves outside the fold home", async () => {
  const { run, state } = await trial("without-plugin");
  expect(run.variant).toBe("without-plugin");
  const writePath = String(run.turns[0].actions[3].args.path);
  expect(writePath.startsWith(run.foldHome)).toBe(false);
  expect(state.notes).toEqual([`${writePath}:note`]);
  expect(run.turns.map(turn => turn.reply)).toEqual(["done 1", "done 2"]);
}, 120_000);

test("a scripted write to an existing target fails the trial", async () => {
  const existing: Scenario<State> = {
    ...scenario({ "taken.md": "old" }),
    turns: [
      {
        prompt: "q",
        script: [
          { kind: "write", path: "taken.md", content: "new" },
          { kind: "reply", text: "x" },
        ],
      },
    ],
  };
  await expect(piHarness.runTrial(existing, { variant: "without-plugin", model: "unused" })).rejects.toThrow(
    "scripted write target already exists",
  );
}, 60_000);

test("selectScenarios keeps the named scenario and rejects unknown names with the valid list", () => {
  const title = scenarios[0].title;
  expect(selectScenarios(scenarios, title).map(scenario => scenario.title)).toEqual([title]);
  expect(selectScenarios(scenarios, undefined)).toBe(scenarios);
  expect(() => selectScenarios(scenarios, "nope")).toThrow(scenarios[1].title);
});
