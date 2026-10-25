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

test("a folded run keeps every steered and queued user message and only the last reply to each", async () => {
  sandbox = createSandbox();
  server = await startServer(sandbox);
  const { provider } = sandbox;
  const session = await server.createSession();

  await server.prompt(session, "r1");
  await server.waitForIdles(session, 1);

  await server.prompt(session, "r2 HOLD");
  await provider.received("r2 HOLD");
  await server.prompt(session, "r2 steer", "steer");
  provider.releaseHeld();
  await server.waitForIdles(session, 2);

  await server.prompt(session, "r3 CALLWAIT:r3");
  await provider.toolStarted("r3");
  await server.prompt(session, "r3 queue", "queue");
  provider.releaseTool("r3");
  await server.waitForIdles(session, 3);

  await server.prompt(session, "r4 CALLWAIT:r4");
  await provider.toolStarted("r4");
  await server.prompt(session, "r4 steer", "steer");
  provider.releaseTool("r4");
  await server.waitForIdles(session, 4);

  await server.prompt(session, "r5");
  await server.waitForIdles(session, 5);

  expect(compactRequest(provider.lastAgentRequest())).toEqual([
    "user:r1",
    "assistant:reply: r1",
    "user:r2 HOLD",
    "assistant:held reply: r2 HOLD",
    "user:r2 steer",
    "assistant:reply: r2 steer",
    "user:r3 CALLWAIT:r3",
    "assistant:after tool: r3 CALLWAIT:r3",
    "user:r3 queue",
    "assistant:reply: r3 queue",
    "user:r4 CALLWAIT:r4",
    "user:r4 steer",
    "assistant:reply: r4 steer",
    "user:r5",
    "index",
  ]);
}, 90_000);
