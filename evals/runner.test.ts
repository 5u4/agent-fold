import { expect, test } from "bun:test";
import type { Harness, Scenario } from "./contract";
import { type Row, summarize } from "./report";
import { runTrialRow } from "./runner";

const scenario: Scenario<number> = {
  title: "fake scenario",
  turns: ["hello"],
  async setup() {
    return 7;
  },
  grade: (run, state) => ({ status: state === 7 && run.turns[0].reply === "hi" ? "pass" : "fail", evidence: "graded" }),
  metrics: run => ({ "tool calls": run.turns[0].actions.length }),
};

test("an unsupported outcome becomes an unsupported row", async () => {
  const harness: Harness = { name: "fake", runTrial: async () => ({ unsupported: "no scripted replay" }) };
  expect(await runTrialRow(harness, scenario, { variant: "with-plugin", model: "m" })).toEqual({
    verdict: { status: "unsupported", evidence: "no scripted replay" },
    metrics: {},
  });
});

test("a supported outcome is graded and measured", async () => {
  const harness: Harness = {
    name: "fake",
    runTrial: async <S>(s: Scenario<S>) => ({
      run: { variant: "with-plugin", foldHome: "/fold", turns: [{ prompt: "hello", reply: "hi", actions: [], modelInputs: [] }] },
      state: await s.setup("/work"),
    }),
  };
  expect(await runTrialRow(harness, scenario, { variant: "with-plugin", model: "m" })).toEqual({
    verdict: { status: "pass", evidence: "graded" },
    metrics: { "tool calls": 0 },
  });
});

test("summarize counts each status and averages metrics over valid trials", () => {
  const row = (status: Row["verdict"]["status"], metrics: Record<string, number>): Row => ({
    harness: "fake",
    scenario: "fake scenario",
    model: "m",
    variant: "with-plugin",
    trial: 1,
    verdict: { status, evidence: "" },
    metrics,
  });
  expect(summarize([row("unsupported", {}), row("pass", { m: 2 }), row("fail", { m: 4 }), row("invalid", { m: 100 })])).toEqual([
    "fake scenario / with-plugin: pass 1/2, invalid 1, unsupported 1, mean m 3.00",
  ]);
});
