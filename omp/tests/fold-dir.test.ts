import { expect, test } from "bun:test";
import { basename, dirname, join } from "node:path";
import { FOLD_DIR } from "@agent-fold/evals";
import { runTrial } from "../harness/run-omp";
import type { ScriptedRequest, Turn } from "../harness/types";

function toolResultText(turn: Turn): string {
  return turn.messages
    .flatMap(message => (message.role === "toolResult" ? message.content : []))
    .flatMap(block => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

test("both runs of a continued session get the same fold dir, created before run 1 writes to it", async () => {
  const { run } = await runTrial(
    {
      async setup() {},
      turns: [
        {
          prompt: "q1",
          script: [
            { toolCall: { name: "bash", arguments: { command: `test -d ${FOLD_DIR}/ && echo fold-dir-exists` } } },
            { toolCall: { name: "write", arguments: { path: `${FOLD_DIR}/note.md`, content: "NOTE-kept\n" } } },
            { text: "done 1" },
          ],
        },
        {
          prompt: "q2",
          script: [{ toolCall: { name: "read", arguments: { path: `${FOLD_DIR}/note.md` } } }, { text: "done 2" }],
        },
      ],
    },
    { variant: "with-plugin", model: "scripted/scripted" },
  );
  const rootEntry = run.turns[0].entries.find(entry => entry.parentId === null);
  if (!rootEntry) throw new Error("turn 1 wrote no branch root entry");
  const startedAt = rootEntry.timestamp.replace(/\D/g, "").slice(0, 14);
  const expected = join(run.foldHome, `-tmp-${basename(dirname(run.foldHome))}-workdir`, "omp", `${startedAt}-${rootEntry.id}`);
  const systemPrompts = run.turns.map(turn => (turn.requests[0] as ScriptedRequest).systemPrompt.join("\n"));
  expect(systemPrompts.map(prompt => prompt.includes(`${expected}/`))).toEqual([true, true]);
  const writePaths = run.turns[0].messages
    .flatMap(message => (message.role === "assistant" ? message.content : []))
    .flatMap(block => (block.type === "toolCall" && block.name === "write" ? [block.arguments.path] : []));
  expect(writePaths).toEqual([`${expected}/note.md`]);
  expect(toolResultText(run.turns[0])).toContain("fold-dir-exists");
  expect(toolResultText(run.turns[1])).toContain("NOTE-kept");
}, 120_000);
