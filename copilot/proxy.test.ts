import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { startProxy } from "./proxy";
import { PROTOCOL, queryProxy } from "./proxy-state";

type Seen = { method: string; path: string; headers: Headers; body: string };

const SECRET = "a".repeat(64);
const SESSION = "4390376c-2266-4658-b66d-330ae07cbad8";
const LAUNCH = "68185701-af3a-41f0-9806-28fc1bf16145";
const START_TIME = "2026-10-20T20:45:42.123Z";

let seen: Seen[] = [];
let releaseSecondChunk: () => void = () => {};
let discoveryCalls = 0;
let root: string;
let stateDir: string;
let foldHome: string;
let cwd: string;
let proxy: Bun.Server<undefined>;

const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    seen.push({ method: request.method, path: `${url.pathname}${url.search}`, headers: request.headers, body: await request.text() });
    if (url.pathname.endsWith("/stream")) {
      const { promise: released, resolve } = Promise.withResolvers<void>();
      releaseSecondChunk = resolve;
      const encoder = new TextEncoder();
      const body = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode("data: one\n\n"));
          await released;
          controller.enqueue(encoder.encode("data: two\n\n"));
          controller.close();
        },
      });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ ok: true });
  },
});

const discovery = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    discoveryCalls++;
    if (request.headers.get("authorization") !== "Bearer gho_test") return new Response("no", { status: 401 });
    return Response.json({ endpoints: { api: `http://127.0.0.1:${upstream.port}/api` } });
  },
});

const fixtureText = (name: string) => Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url)).text();

function writeSessionStart(sessionId: string) {
  mkdirSync(join(stateDir, sessionId), { recursive: true });
  const start = { type: "session.start", data: { sessionId, startTime: START_TIME, context: { cwd } }, id: `root-${sessionId}` };
  writeFileSync(join(stateDir, sessionId, "events.jsonl"), `${JSON.stringify(start)}\n`);
}

function send(port: number, path: string, init: RequestInit = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, init);
}

function modelRequest(interaction: string, body: string, sessionId = SESSION): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", "x-interaction-type": interaction, "x-client-session-id": sessionId },
    body,
  };
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "agent-fold-proxy-")));
});

afterAll(() => {
  upstream.stop(true);
  discovery.stop(true);
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  seen = [];
  discoveryCalls = 0;
  const dir = mkdtempSync(join(root, "case-"));
  stateDir = join(dir, "session-state");
  foldHome = join(dir, "fold-home");
  cwd = join(dir, "project");
  mkdirSync(stateDir);
  mkdirSync(cwd);
  proxy = startProxy({ upstream: new URL(`http://127.0.0.1:${upstream.port}`), secret: SECRET, foldHome, sessionStateDir: stateDir });
});

afterEach(() => {
  proxy.stop(true);
});

const expectedFoldDir = () =>
  join(foldHome, `-tmp-${basename(root)}-${basename(dirname(cwd))}-project`, "copilot", `20261020204542-${SESSION}`);

test("a main-agent /responses request reaches the upstream folded, with the rules and a created fold dir", async () => {
  writeSessionStart(SESSION);
  const text = await fixtureText("responses-steering");
  const fixture = JSON.parse(text);
  const response = await send(proxy.port ?? 0, "/responses", modelRequest("conversation-agent", text));
  expect(response.status).toBe(200);
  expect(seen).toHaveLength(1);
  const body = JSON.parse(seen[0].body);
  const types = (body.input as { type?: string }[]).map(item => item.type);
  expect(types).not.toContain("function_call");
  expect(types).not.toContain("function_call_output");
  expect(types).not.toContain("reasoning");
  expect(body.input).toContainEqual(fixture.input.at(-1));
  const dir = expectedFoldDir();
  expect(body.instructions.startsWith(fixture.instructions)).toBe(true);
  expect(body.instructions).toContain(`\`${dir}/INDEX.md\` lists where earlier runs found things`);
  expect(existsSync(dir)).toBe(true);
});

test("the first request of a run is folded too", async () => {
  writeSessionStart(SESSION);
  const text = await fixtureText("responses-steering");
  await send(proxy.port ?? 0, "/responses", modelRequest("conversation-user", text));
  expect(JSON.parse(seen[0].body).instructions).toContain(`${expectedFoldDir()}/INDEX.md`);
});

test("subagent and compaction requests reach the upstream byte-identical", async () => {
  writeSessionStart(SESSION);
  for (const [interaction, name] of [
    ["conversation-subagent", "responses-steering"],
    ["conversation-compaction", "responses-compaction"],
    ["conversation-background", "responses-classifier"],
  ]) {
    const text = await fixtureText(name);
    await send(proxy.port ?? 0, "/responses", modelRequest(interaction, text));
    expect(seen.at(-1)?.body).toBe(text);
  }
  expect(existsSync(foldHome)).toBe(false);
});

test("a session with no state on disk is forwarded unchanged, then folds once its state exists", async () => {
  const text = await fixtureText("responses-steering");
  await send(proxy.port ?? 0, "/responses", modelRequest("conversation-agent", text));
  expect(seen[0].body).toBe(text);
  writeSessionStart(SESSION);
  await send(proxy.port ?? 0, "/responses", modelRequest("conversation-agent", text));
  expect(seen[1].body).not.toBe(text);
  expect(JSON.parse(seen[1].body).instructions).toContain(`${expectedFoldDir()}/INDEX.md`);
});

test("a WebSocket upgrade gets 404 and nothing reaches the upstream", async () => {
  const response = await send(proxy.port ?? 0, "/responses", { headers: { upgrade: "websocket", connection: "Upgrade" } });
  expect(response.status).toBe(404);
  expect(seen).toEqual([]);
});

test("a request naming another host gets 403 and nothing reaches the upstream", async () => {
  const response = await send(proxy.port ?? 0, "/models", { headers: { host: "attacker.example" } });
  expect(response.status).toBe(403);
  expect(seen).toEqual([]);
});

test("a launch prefix is stripped before forwarding and reported by status", async () => {
  const port = proxy.port ?? 0;
  const response = await send(port, `/launch/${LAUNCH}/models?api-version=1`, { headers: { authorization: "Bearer gho_test" } });
  expect(await response.json()).toEqual({ ok: true });
  expect(seen.map(({ method, path }) => ({ method, path }))).toEqual([{ method: "GET", path: "/models?api-version=1" }]);
  expect(seen[0].headers.get("authorization")).toBe("Bearer gho_test");
  expect(await queryProxy(port, SECRET, { launch: LAUNCH })).toEqual({ protocol: PROTOCOL, launchSeen: true, sessionSeen: false });
  expect(await queryProxy(port, SECRET, { launch: SESSION })).toEqual({ protocol: PROTOCOL, launchSeen: false, sessionSeen: false });
});

test("status reports a session only when a request of it came through at or after since", async () => {
  const port = proxy.port ?? 0;
  const unseen = { protocol: PROTOCOL, launchSeen: false, sessionSeen: false };
  const seen = { protocol: PROTOCOL, launchSeen: false, sessionSeen: true };
  expect(await queryProxy(port, SECRET, { session: { id: SESSION, since: 0 } })).toEqual(unseen);
  const before = Date.now();
  await send(port, "/chat/completions", modelRequest("conversation-background", "{}"));
  const after = Date.now() + 1;
  expect(await queryProxy(port, SECRET, { session: { id: SESSION, since: before } })).toEqual(seen);
  expect(await queryProxy(port, SECRET, { session: { id: SESSION, since: after } })).toEqual(unseen);
  expect(await queryProxy(port, SECRET, { session: { id: SESSION.toUpperCase(), since: before } })).toEqual(seen);
});

test("status proves the proxy only to a caller holding its secret", async () => {
  const port = proxy.port ?? 0;
  expect(await queryProxy(port, SECRET, {})).toEqual({ protocol: PROTOCOL, launchSeen: false, sessionSeen: false });
  expect(await queryProxy(port, "b".repeat(64), {})).toBeUndefined();
  expect(seen).toEqual([]);
});

test("a status relayed from another port does not prove the proxy, even with its fields rewritten", async () => {
  const port = proxy.port ?? 0;
  const relays = [{}, { protocol: PROTOCOL + 1 }, { sessionSeen: true }].map(rewrite =>
    Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const status = await (await send(port, `${url.pathname}${url.search}`)).json();
        return Response.json({ ...status, ...rewrite });
      },
    }),
  );
  try {
    const relayed = await Promise.all(relays.map(relay => queryProxy(relay.port ?? 0, SECRET, { session: { id: SESSION, since: 0 } })));
    expect(relayed).toEqual([undefined, undefined, undefined]);
    expect(await queryProxy(port, SECRET, { session: { id: SESSION, since: 0 } })).toEqual({
      protocol: PROTOCOL,
      launchSeen: false,
      sessionSeen: false,
    });
  } finally {
    for (const relay of relays) relay.stop(true);
  }
});

test("an SSE response streams through chunk by chunk", async () => {
  const response = await send(proxy.port ?? 0, "/stream", modelRequest("conversation-agent", "{}"));
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  expect(decoder.decode((await reader.read()).value)).toBe("data: one\n\n");
  releaseSecondChunk();
  expect(decoder.decode((await reader.read()).value)).toBe("data: two\n\n");
  expect((await reader.read()).done).toBe(true);
});

test("without an upstream, discovery runs once per token and its endpoint path is kept", async () => {
  const discovering = startProxy({
    upstream: undefined,
    secret: SECRET,
    discoveryUrl: new URL(`http://127.0.0.1:${discovery.port}/copilot_internal/user`),
    foldHome,
    sessionStateDir: stateDir,
  });
  try {
    const port = discovering.port ?? 0;
    const auth = { headers: { authorization: "Bearer gho_test" } };
    expect((await send(port, "/models", auth)).status).toBe(200);
    expect((await send(port, "/models", auth)).status).toBe(200);
    expect(seen.map(({ path }) => path)).toEqual(["/api/models", "/api/models"]);
    expect(discoveryCalls).toBe(1);
    const denied = await send(port, "/models", { headers: { authorization: "Bearer other" } });
    expect(denied.status).toBe(502);
    expect(await send(port, "/models")).toHaveProperty("status", 502);
    expect(discoveryCalls).toBe(2);
  } finally {
    discovering.stop(true);
  }
});
