import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createSandbox, PLUGIN, type PiSandbox } from "../harness/sandbox";
import { compactRequest } from "../harness/view";

const BREAK_FOLD = join(import.meta.dir, "..", "harness", "break-fold.ts");

let sandbox: PiSandbox;

afterEach(() => sandbox.dispose());

test("when folding throws, the provider gets the unfolded messages", async () => {
  sandbox = createSandbox();
  sandbox.provider.enqueue({ toolCall: { name: "bash", arguments: { command: "echo hi" } } }, { text: "done 1" }, { text: "done 2" });
  expect((await sandbox.print(["q1"])).exitCode).toBe(0);
  const run2 = await sandbox.print(["q2"], { continue: true, extensions: [BREAK_FOLD, PLUGIN] });
  expect(run2).toMatchObject({ exitCode: 0, stdout: "done 2\n" });
  expect(compactRequest(sandbox.provider.requests[2])).toEqual([
    "user:q1",
    "assistant:toolCall:bash",
    "tool:hi\n",
    "assistant:done 1",
    "user:q2",
  ]);
}, 60_000);
