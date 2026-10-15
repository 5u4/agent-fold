import { expect, test } from "bun:test";
import type { Message } from "@oh-my-pi/pi-ai";
import { runTrial } from "../harness/run-omp";
import { FOLD_DIR, type ScriptedRequest } from "../harness/types";
import { compactMessage } from "../harness/view";

const write = (content: string) => ({ toolCall: { name: "write", arguments: { path: `${FOLD_DIR}/INDEX.md`, content } } });

function view(messages: Message[]): string[] {
  return messages.flatMap(message => {
    if (message.role !== "developer") return compactMessage(message);
    const text = typeof message.content === "string" ? message.content : message.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
    const index = text.match(/^Session index `.*\/INDEX\.md` at the start of this run:\n\n([\s\S]*)\n\nBefore your final reply/);
    return [index ? `index:${index[1]}` : "developer"];
  });
}

test("each run sees the INDEX.md snapshot from its start, after its own user message only", async () => {
  const { run } = await runTrial(
    {
      async setup() {},
      turns: [
        { prompt: "q1", script: [write("- A\n"), { text: "done 1" }] },
        { prompt: "q2", script: [write("- A\n- B\n"), { text: "done 2" }] },
        { prompt: "q3", script: [{ text: "done 3" }] },
      ],
    },
    { variant: "with-plugin", model: "scripted/scripted" },
  );
  const requests = run.turns.map(turn => (turn.requests as ScriptedRequest[]).map(r => view(r.messages)));
  expect(requests[0]).toEqual([
    ["user:q1", "index:(empty)"],
    ["user:q1", "index:(empty)", "assistant:toolCall:write", "toolResult:write"],
  ]);
  expect(requests[1]).toEqual([
    ["user:q1", "assistant:text:done 1", "user:q2", "index:- A\n"],
    ["user:q1", "assistant:text:done 1", "user:q2", "index:- A\n", "assistant:toolCall:write", "toolResult:write"],
  ]);
  expect(requests[2]).toEqual([["user:q1", "assistant:text:done 1", "user:q2", "assistant:text:done 2", "user:q3", "index:- A\n- B\n"]]);
}, 180_000);
