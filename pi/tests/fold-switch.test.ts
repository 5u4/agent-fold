import { afterEach, expect, test } from "bun:test";
import { createSandbox, type PiSandbox } from "../harness/sandbox";
import { compactRequest, systemPrompt } from "../harness/view";

let sandbox: PiSandbox;

afterEach(() => sandbox.dispose());

const unfolded = (run: number) => [`user:q${run}`, "assistant:toolCall:bash", "tool:hi\n", `assistant:done ${run}`];
const folded = (run: number) => [`user:q${run}`, `assistant:done ${run}`];

async function toolRun(run: number, commands: string[] = []) {
  sandbox.provider.enqueue({ toolCall: { name: "bash", arguments: { command: "echo hi" } } }, { text: `done ${run}` });
  const before = sandbox.provider.requests.length;
  const result = await sandbox.print([...commands, `q${run}`], { continue: run > 1 });
  expect(result.exitCode).toBe(0);
  const request = sandbox.provider.requests[before];
  return { view: compactRequest(request), foldRules: systemPrompt(request).includes("# Folded runs") };
}

const switchEntries = () =>
  sandbox.entries().flatMap(entry => (entry.type === "custom" && entry.customType === "agent-fold.switch" ? [entry.data] : []));

test("/agent-fold off sends the session as without the plugin until /agent-fold on", async () => {
  sandbox = createSandbox();
  expect(await toolRun(1)).toEqual({ view: ["user:q1", "index"], foldRules: true });
  expect(await toolRun(2, ["/agent-fold off", "/agent-fold off"])).toEqual({ view: [...unfolded(1), "user:q2"], foldRules: false });
  expect(switchEntries()).toEqual([{ enabled: false }]);
  expect(await toolRun(3)).toEqual({ view: [...unfolded(1), ...unfolded(2), "user:q3"], foldRules: false });
  expect(await toolRun(4, ["/agent-fold status", "/agent-fold on"])).toEqual({
    view: [...folded(1), ...folded(2), ...folded(3), "user:q4", "index"],
    foldRules: true,
  });
  expect(switchEntries()).toEqual([{ enabled: false }, { enabled: true }]);
}, 120_000);
