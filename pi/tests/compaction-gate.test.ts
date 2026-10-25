import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSandbox, type PiSandbox } from "../harness/sandbox";
import { text } from "../harness/view";

let sandbox: PiSandbox;

afterEach(() => sandbox.dispose());

const compactions = () => sandbox.entries().filter(entry => entry.type === "compaction");

function keepNothingRecent() {
  sandbox = createSandbox();
  writeFileSync(join(sandbox.agentDir, "settings.json"), JSON.stringify({ compaction: { keepRecentTokens: 1 } }));
}

const bigOutput = { toolCall: { name: "bash", arguments: { command: "head -c 40000 /dev/zero | tr '\\0' x; echo NONCE-tool" } } };

async function overThreshold(reportedTokens: number, extensions?: string[]) {
  keepNothingRecent();
  sandbox.provider.enqueue(...Array(8).fill(bigOutput), { text: "done 1", inputTokens: reportedTokens }, { text: "pi summary" }, { text: "pi summary" });
  expect((await sandbox.print(["q1"], { extensions })).exitCode).toBe(0);
}

test("threshold compaction is cancelled when the folded request, overhead included, fits under the threshold", async () => {
  await overThreshold(90_000);
  expect(sandbox.provider.requests).toHaveLength(9);
  expect(compactions()).toEqual([]);
}, 60_000);

test("threshold compaction proceeds when request overhead alone keeps the folded request over the threshold", async () => {
  await overThreshold(170_000);
  expect(compactions()).toHaveLength(1);
}, 60_000);

test("without the plugin, the same session compacts at the threshold", async () => {
  await overThreshold(90_000, []);
  expect(sandbox.provider.requests.length).toBeGreaterThan(9);
  expect(compactions()).toHaveLength(1);
}, 60_000);

async function manualCompaction(extensions?: string[]) {
  keepNothingRecent();
  sandbox.provider.enqueue(
    { toolCall: { name: "bash", arguments: { command: "echo NONCE-tool" } } },
    { text: "done 1" },
    { text: "done 2" },
  );
  expect((await sandbox.print(["q1"], { extensions })).exitCode).toBe(0);
  expect((await sandbox.print(["q2"], { continue: true, extensions })).exitCode).toBe(0);
  sandbox.provider.enqueue({ text: "summary" }, { text: "summary" });
  expect(await sandbox.compact({ extensions })).toMatchObject({ success: true });
  expect(compactions()).toHaveLength(1);
  return sandbox.provider.requests
    .slice(3)
    .flatMap(request => request.messages.map(text))
    .join("\n");
}

test("manual compaction summarizes the folded runs", async () => {
  const summarized = await manualCompaction();
  expect(summarized).toContain("done 1");
  expect(summarized).not.toContain("NONCE-tool");
}, 60_000);

test("without the plugin, manual compaction summarizes tool output", async () => {
  expect(await manualCompaction([])).toContain("NONCE-tool");
}, 60_000);
