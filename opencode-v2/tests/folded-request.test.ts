import { afterEach, expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectSlug } from "../fold-dir";
import { INDEX_PREFIX, text } from "../harness/fake-provider";
import { runStandalone } from "../harness/opencode";
import { createSandbox, type Sandbox } from "../harness/sandbox";
import { compactRequest, systemPrompt } from "../harness/view";

let sandbox: Sandbox;

afterEach(() => sandbox.dispose());

async function twoRuns(plugin: boolean) {
  sandbox = createSandbox({ plugin });
  const run1 = await runStandalone(sandbox, "q1 CALLREAD");
  expect(run1.exitCode).toBe(0);
  const run2 = await runStandalone(sandbox, "q2", { session: run1.sessionID });
  expect(run2.exitCode).toBe(0);
  return sandbox.provider.agentRequests();
}

test("run 2's request carries run 1 as its user message and final reply, then the index after q2", async () => {
  const requests = await twoRuns(true);
  expect(requests.map(compactRequest)).toEqual([
    ["user:q1 CALLREAD", "index"],
    ["user:q1 CALLREAD", "index", "assistant:toolCall:read", "tool"],
    ["user:q1 CALLREAD", "assistant:after tool: q1 CALLREAD", "user:q2", "index"],
  ]);
  expect(systemPrompt(requests[2])).toContain("# Folded runs");
}, 60_000);

test("without the plugin, run 2's request carries run 1's tool call", async () => {
  const requests = await twoRuns(false);
  expect(compactRequest(requests[2])).toEqual([
    "user:q1 CALLREAD",
    "assistant:toolCall:read",
    "tool",
    "assistant:after tool: q1 CALLREAD",
    "user:q2",
  ]);
  expect(systemPrompt(requests[2])).not.toContain("# Folded runs");
}, 60_000);

test("the index names the session's fold dir and shows INDEX.md as it was when the run started", async () => {
  sandbox = createSandbox();
  const run1 = await runStandalone(sandbox, "q1");
  const sessions = join(sandbox.home, ".agent-fold", projectSlug(sandbox.project), "opencode-v2");
  const [dirName] = readdirSync(sessions);
  expect(dirName).toMatch(new RegExp(`^\\d{14}-${run1.sessionID}$`));
  const dir = join(sessions, dirName);
  writeFileSync(join(dir, "INDEX.md"), "- note.txt — what does the note say? NOTE-CONTENT\n");

  await runStandalone(sandbox, "q2", { session: run1.sessionID });
  const request = sandbox.provider.lastAgentRequest();
  const index = request.messages.map(text).find(body => body.startsWith(INDEX_PREFIX));
  expect(index).toStartWith(
    `${INDEX_PREFIX}${dir}/INDEX.md\` at the start of this run:\n\n- note.txt — what does the note say? NOTE-CONTENT\n`,
  );
  expect(systemPrompt(request)).toContain(`\`${dir}/INDEX.md\` lists where earlier runs found things.`);
}, 60_000);
