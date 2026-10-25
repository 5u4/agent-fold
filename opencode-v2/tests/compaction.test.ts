import { afterEach, expect, test } from "bun:test";
import { type Server, startServer, type TranscriptEntry } from "../harness/opencode";
import { createSandbox, type Sandbox } from "../harness/sandbox";
import { compactRequest } from "../harness/view";

let sandbox: Sandbox;
let server: Server;

afterEach(async () => {
  await server.stop();
  sandbox.dispose();
});

function answered(prompt: string) {
  return (entries: TranscriptEntry[]) =>
    entries.at(-1)?.type === "idle" && entries.some(entry => entry.type === "user" && entry.text === prompt);
}

function compacted(reason: string) {
  return (entries: TranscriptEntry[]) =>
    entries[0]?.type === "compaction" &&
    entries[0].status === "completed" &&
    entries[0].reason === reason &&
    entries.at(-1)?.type === "idle";
}

test("the compaction checkpoint survives the fold and the index follows it when it heads the run", async () => {
  sandbox = createSandbox({ contextLimit: 20_000 });
  server = await startServer(sandbox);
  const { provider } = sandbox;
  const session = await server.createSession();

  await server.prompt(session, "r1 CALLREAD");
  await server.waitForTranscript(session, answered("r1 CALLREAD"));
  await server.api("session.compact", { params: { sessionID: session }, data: {} });
  await server.waitForTranscript(session, compacted("manual"));

  await server.prompt(session, "r2 CALLREAD");
  await server.waitForTranscript(session, answered("r2 CALLREAD"));
  await server.prompt(session, "r3");
  await server.waitForTranscript(session, answered("r3"));
  expect(compactRequest(provider.lastAgentRequest())).toEqual([
    "checkpoint",
    "user:r2 CALLREAD",
    "assistant:after tool: r2 CALLREAD",
    "user:r3",
    "index",
  ]);

  await server.prompt(session, "r4 BIG CALLREAD");
  const afterAuto = await server.waitForTranscript(session, compacted("auto"));
  expect(afterAuto.map(entry => entry.type)).toEqual(["compaction", "assistant", "idle"]);
  const autoRequests = provider.agentRequests().slice(-2);
  expect(autoRequests.map(compactRequest)).toEqual([
    [
      "checkpoint",
      "user:r2 CALLREAD",
      "assistant:after tool: r2 CALLREAD",
      "user:r3",
      "assistant:reply: r3",
      "user:r4 BIG CALLREAD",
      "index",
    ],
    ["checkpoint", "index"],
  ]);

  await server.prompt(session, "r5");
  await server.waitForTranscript(session, answered("r5"));
  expect(compactRequest(provider.lastAgentRequest())).toEqual(["checkpoint", "assistant:reply: ", "user:r5", "index"]);
}, 90_000);
