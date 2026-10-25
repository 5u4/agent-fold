import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, type PiSandbox } from "../harness/sandbox";
import { compactRequest, systemPrompt } from "../harness/view";

let sandbox: PiSandbox;

afterEach(() => sandbox.dispose());

async function twoRuns(extensions?: string[]) {
  sandbox = createSandbox();
  writeFileSync(join(sandbox.workdir, "nonce.txt"), "NONCE-folded\n");
  sandbox.provider.enqueue({ toolCall: { name: "read", arguments: { path: "nonce.txt" } } }, { text: "done 1" });
  const run1 = await sandbox.print(["q1 read nonce.txt"], { extensions });
  expect(run1).toMatchObject({ exitCode: 0, stdout: "done 1\n" });
  sandbox.provider.enqueue({ text: "done 2" });
  const run2 = await sandbox.print(["q2"], { continue: true, extensions });
  expect(run2).toMatchObject({ exitCode: 0, stdout: "done 2\n" });
  return sandbox.provider.requests;
}

test("the plugin sends run 1 to the provider as its user message and final reply", async () => {
  const requests = await twoRuns();
  expect(requests.map(compactRequest)).toEqual([
    ["user:q1 read nonce.txt", "index"],
    ["user:q1 read nonce.txt", "index", "assistant:toolCall:read", "tool:NONCE-folded\n"],
    ["user:q1 read nonce.txt", "assistant:done 1", "user:q2", "index"],
  ]);
  expect(systemPrompt(requests[2])).toContain("# Folded runs");
}, 60_000);

test("without the plugin, run 1 reaches the provider unfolded", async () => {
  const requests = await twoRuns([]);
  expect(compactRequest(requests[2])).toEqual([
    "user:q1 read nonce.txt",
    "assistant:toolCall:read",
    "tool:NONCE-folded\n",
    "assistant:done 1",
    "user:q2",
  ]);
  expect(systemPrompt(requests[2])).not.toContain("# Folded runs");
}, 60_000);
