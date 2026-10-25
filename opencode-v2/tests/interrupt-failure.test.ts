import { afterEach, expect, test } from "bun:test";
import { type Server, startServer } from "../harness/opencode";
import { createSandbox, type Sandbox } from "../harness/sandbox";
import { compactRequest } from "../harness/view";

let sandbox: Sandbox;
let server: Server;

afterEach(async () => {
  await server.stop();
  sandbox.dispose();
});

test("an interrupted run and a failed run fold to their user message with no assistant", async () => {
  sandbox = createSandbox();
  server = await startServer(sandbox);
  const { provider } = sandbox;
  const session = await server.createSession();

  await server.prompt(session, "r1");
  await server.waitForIdles(session, 1);

  await server.prompt(session, "r2 CALLWAIT:r2");
  await provider.toolStarted("r2");
  await server.api("session.interrupt", { params: { sessionID: session } });
  await server.waitForIdles(session, 2);

  await server.prompt(session, "r3 FAIL");
  await server.waitForIdles(session, 3);

  await server.prompt(session, "r4");
  const transcript = await server.waitForIdles(session, 4);

  expect(transcript.filter(entry => entry.type === "idle").map(entry => entry.outcome)).toEqual([
    "succeeded",
    "interrupted",
    "failed",
    "succeeded",
  ]);
  expect(compactRequest(provider.lastAgentRequest())).toEqual([
    "user:r1",
    "assistant:reply: r1",
    "user:r2 CALLWAIT:r2",
    "user:r3 FAIL",
    "user:r4",
    "index",
  ]);
}, 90_000);
