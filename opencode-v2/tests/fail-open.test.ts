import { afterEach, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runStandalone } from "../harness/opencode";
import { createSandbox, type Sandbox } from "../harness/sandbox";
import { compactRequest, systemPrompt } from "../harness/view";

let sandbox: Sandbox;

afterEach(() => sandbox.dispose());

test("when the fold dir cannot be created, the provider gets the unfolded messages and the run succeeds", async () => {
  sandbox = createSandbox();
  writeFileSync(join(sandbox.home, ".agent-fold"), "not a directory\n");
  const run1 = await runStandalone(sandbox, "q1 CALLREAD");
  expect(run1.exitCode).toBe(0);
  const run2 = await runStandalone(sandbox, "q2", { session: run1.sessionID });
  expect(run2.exitCode).toBe(0);
  const request = sandbox.provider.lastAgentRequest();
  expect(compactRequest(request)).toEqual([
    "user:q1 CALLREAD",
    "assistant:toolCall:read",
    "tool",
    "assistant:after tool: q1 CALLREAD",
    "user:q2",
  ]);
  expect(systemPrompt(request)).not.toContain("# Folded runs");

  rmSync(join(sandbox.home, ".agent-fold"));
  const run3 = await runStandalone(sandbox, "q3", { session: run1.sessionID });
  expect(run3.exitCode).toBe(0);
  expect(compactRequest(sandbox.provider.lastAgentRequest())).toEqual([
    "user:q1 CALLREAD",
    "assistant:after tool: q1 CALLREAD",
    "user:q2",
    "assistant:reply: q2",
    "user:q3",
    "index",
  ]);
}, 60_000);
