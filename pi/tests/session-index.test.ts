import { afterEach, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { foldDir } from "../fold-dir";
import { createSandbox, PLUGIN, type PiSandbox } from "../harness/sandbox";
import { text } from "../harness/view";

const QUEUE_FOLLOW_UP = join(import.meta.dir, "..", "harness", "queue-follow-up.ts");

let sandbox: PiSandbox;

afterEach(() => sandbox.dispose());

test("each run carries the INDEX.md snapshot read when it started, right after its first message", async () => {
  sandbox = createSandbox();
  sandbox.provider.enqueue({ text: "done 1" });
  expect((await sandbox.print(["q1"])).exitCode).toBe(0);
  const header = sandbox.entries()[0] as unknown as { id: string; timestamp: string };
  const dir = foldDir({ foldHome: sandbox.foldHome, projectRoot: sandbox.workdir, session: header });
  expect(existsSync(dir)).toBe(true);
  writeFileSync(join(dir, "INDEX.md"), "- nonce.txt — what is the nonce? NONCE-indexed\n");
  sandbox.provider.enqueue({ text: "done 2" });
  expect((await sandbox.print(["q2"], { continue: true })).exitCode).toBe(0);

  const [first, second] = sandbox.provider.requests.map(request => request.messages.filter(message => message.role === "user").map(text));
  expect(first).toEqual(["q1", expect.stringContaining(`${dir}/INDEX.md\` at the start of this run:\n\n(empty)\n`)]);
  expect(second).toEqual(["q1", "q2", expect.stringContaining("- nonce.txt — what is the nonce? NONCE-indexed\n")]);
  expect(JSON.stringify(sandbox.entries())).not.toContain("NONCE-indexed");
}, 60_000);

test("a follow-up queued inside a run starts a run with a fresh INDEX.md snapshot", async () => {
  sandbox = createSandbox();
  sandbox.provider.enqueue({ text: "done 1" });
  expect((await sandbox.print(["q1"])).exitCode).toBe(0);
  const header = sandbox.entries()[0] as unknown as { id: string; timestamp: string };
  const dir = foldDir({ foldHome: sandbox.foldHome, projectRoot: sandbox.workdir, session: header });
  sandbox.env.FOLLOW_UP_INDEX = join(dir, "INDEX.md");
  sandbox.provider.enqueue({ toolCall: { name: "bash", arguments: { command: "echo hi" } } }, { text: "done 2" }, { text: "done 3" });
  const run2 = await sandbox.print(["q2"], { continue: true, extensions: [QUEUE_FOLLOW_UP, PLUGIN] });
  expect(run2.exitCode).toBe(0);

  const last = sandbox.provider.requests.at(-1)?.messages.filter(message => message.role === "user").map(text);
  expect(last).toEqual(["q1", "q2", "follow up", expect.stringContaining("- late.txt — written mid-run? LATE-indexed\n")]);
}, 60_000);
