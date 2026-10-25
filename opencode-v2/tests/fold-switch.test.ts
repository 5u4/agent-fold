import { afterEach, expect, test } from "bun:test";
import { type Server, startServer, type TranscriptEntry } from "../harness/opencode";
import { createSandbox, type Sandbox } from "../harness/sandbox";
import { compactRequest, systemPrompt } from "../harness/view";

type SessionInfo = { metadata?: { agentFold?: { enabled: boolean; at: number }; other?: unknown } };

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

async function ask(session: string, prompt: string) {
  const before = sandbox.provider.agentRequests().length;
  await server.prompt(session, prompt);
  await server.waitForTranscript(session, answered(prompt));
  return sandbox.provider.agentRequests()[before];
}

async function foldCommand(session: string, text: string) {
  await server.api("session.command", { params: { sessionID: session }, data: { name: "agent-fold", text } });
  return (await server.api<SessionInfo>("session.get", { params: { sessionID: session } })).metadata;
}

test("/agent-fold off sends the next request unfolded, on folds again, and status changes nothing", async () => {
  sandbox = createSandbox();
  server = await startServer(sandbox);
  const control = await server.createSession();
  for (const prompt of ["r1 CALLREAD", "r2 CALLREAD", "r3"]) await ask(control, prompt);
  const controlRequest = await ask(control, "r4");

  const session = await server.createSession();
  await ask(session, "r1 CALLREAD");
  await server.api("session.update", { params: { sessionID: session }, data: { metadata: { other: { x: 1 } } } });

  const off = await foldCommand(session, "off");
  expect(off).toMatchObject({ other: { x: 1 }, agentFold: { enabled: false } });
  const unfolded = await ask(session, "r2 CALLREAD");
  expect(compactRequest(unfolded)).toEqual([
    "user:r1 CALLREAD",
    "assistant:toolCall:read",
    "tool",
    "assistant:after tool: r1 CALLREAD",
    "user:r2 CALLREAD",
  ]);
  expect(systemPrompt(unfolded)).not.toContain("# Folded runs");

  const on = await foldCommand(session, "on");
  expect(on).toMatchObject({ other: { x: 1 }, agentFold: { enabled: true } });
  const folded = await ask(session, "r3");
  expect(compactRequest(folded)).toEqual([
    "user:r1 CALLREAD",
    "assistant:after tool: r1 CALLREAD",
    "user:r2 CALLREAD",
    "assistant:after tool: r2 CALLREAD",
    "user:r3",
    "index",
  ]);
  expect(systemPrompt(folded)).toContain("# Folded runs");

  const status = await foldCommand(session, "status");
  expect(status).toMatchObject({ other: { x: 1 }, agentFold: { enabled: true } });
  expect(status?.agentFold?.at).toBeGreaterThan(on?.agentFold?.at ?? Number.POSITIVE_INFINITY);
  expect(compactRequest(await ask(session, "r4"))).toEqual(compactRequest(controlRequest));

  await expect(foldCommand(session, "sideways")).rejects.toThrow();
  expect((await server.api<SessionInfo>("session.get", { params: { sessionID: session } })).metadata).toEqual(status);
}, 90_000);
