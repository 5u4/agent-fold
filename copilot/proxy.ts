import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import rulesTemplate from "./context/fold.md" with { type: "text" };
import { type Format, type Injection, type JsonObject, rewriteBody } from "./fold";
import { findProjectRoot, foldDir, withFoldDir } from "./fold-dir";
import { formats } from "./formats";
import { PROTOCOL, proof, STATUS_PATH } from "./proxy-state";
import { indexMessage } from "./session-index";
import { type ConversationRoot, conversationRoot } from "./session-root";

export type ProxyOptions = {
  upstream: URL | undefined;
  secret: string;
  port?: number;
  discoveryUrl?: URL;
  foldHome: string;
  sessionStateDir: string;
};

type Route =
  | { kind: "status" }
  | { kind: "rejectUpgrade" }
  | { kind: "forbidden" }
  | { kind: "fold"; format: Format<object>; sessionId: string }
  | { kind: "forward" };

const DEFAULT_DISCOVERY_URL = new URL("https://api.github.com/copilot_internal/user");

// Copilot CLI 1.0.101 writes events.jsonl of a new session about when it sends the session's first model request.
const SESSION_START_WAIT_MS = 2000;

const SESSION_START_POLL_MS = 50;

const FOLDED_INTERACTIONS: Record<string, true> = { "conversation-user": true, "conversation-agent": true };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LAUNCH_PREFIX = /^\/launch\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=\/|$)/i;

const HOP_BY_HOP = ["connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer"];

function stripLaunch(pathname: string): { path: string; launch: string | undefined } {
  const match = LAUNCH_PREFIX.exec(pathname);
  if (match === null) return { path: pathname, launch: undefined };
  return { path: pathname.slice(match[0].length) || "/", launch: match[1].toLowerCase() };
}

function route(method: string, path: string, headers: Headers, port: number): Route {
  const host = headers.get("host");
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return { kind: "forbidden" };
  if (headers.has("upgrade")) return { kind: "rejectUpgrade" };
  if (method === "GET" && path === STATUS_PATH) return { kind: "status" };
  const format = formats[path];
  const interaction = headers.get("x-interaction-type") ?? "";
  const sessionId = headers.get("x-client-session-id") ?? "";
  const encoding = headers.get("content-encoding") ?? "identity";
  if (
    method === "POST" &&
    format !== undefined &&
    FOLDED_INTERACTIONS[interaction] === true &&
    UUID.test(sessionId) &&
    encoding === "identity"
  ) {
    return { kind: "fold", format, sessionId };
  }
  return { kind: "forward" };
}

function forwardHeaders(headers: Headers, bodyChanged: boolean): Headers {
  const out = new Headers(headers);
  for (const name of ["host", "accept-encoding", ...HOP_BY_HOP]) out.delete(name);
  for (const name of [...out.keys()]) if (name.startsWith("proxy-")) out.delete(name);
  if (bodyChanged) out.delete("content-length");
  return out;
}

function responseHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const name of ["content-encoding", "content-length", ...HOP_BY_HOP]) out.delete(name);
  return out;
}

function readIndex(dir: string): string {
  try {
    return readFileSync(join(dir, "INDEX.md"), "utf8");
  } catch {
    return "";
  }
}

function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const promise = load();
  cache.set(key, promise);
  promise.catch(() => {
    if (cache.get(key) === promise) cache.delete(key);
  });
  return promise;
}

export function startProxy(options: ProxyOptions): Bun.Server<undefined> {
  const { secret, foldHome, sessionStateDir } = options;
  const discoveryUrl = options.discoveryUrl ?? DEFAULT_DISCOVERY_URL;
  const injections = new Map<string, Promise<Injection>>();
  const upstreams = new Map<string, Promise<URL>>();
  const launches = new Set<string>();
  const sessionLastSeen = new Map<string, number>();
  const awaitedStarts = new Set<string>();

  async function sessionRoot(sessionId: string): Promise<ConversationRoot> {
    const deadline = awaitedStarts.has(sessionId) ? 0 : Date.now() + SESSION_START_WAIT_MS;
    awaitedStarts.add(sessionId);
    for (;;) {
      const root = conversationRoot(sessionStateDir, sessionId);
      if (root !== undefined) return root;
      if (Date.now() >= deadline) throw new Error(`no session.start for session ${sessionId}`);
      await Bun.sleep(SESSION_START_POLL_MS);
    }
  }

  async function injectionFor(sessionId: string): Promise<Injection> {
    const root = await sessionRoot(sessionId);
    const dir = foldDir({ foldHome, projectRoot: await findProjectRoot(root.cwd), startTime: root.startTime, sessionId: root.sessionId });
    await mkdir(dir, { recursive: true });
    let run: { key: string; text: string } | undefined;
    return {
      rules: withFoldDir(rulesTemplate, dir),
      index: key => {
        if (run?.key !== key) run = { key, text: indexMessage(dir, readIndex(dir)) };
        return run.text;
      },
    };
  }

  async function discover(authorization: string): Promise<URL> {
    const response = await fetch(discoveryUrl, { headers: { authorization, accept: "application/json" } });
    if (!response.ok) throw new Error(`${discoveryUrl.host} answered ${response.status}`);
    const json: unknown = await response.json();
    const endpoints = typeof json === "object" && json !== null && "endpoints" in json ? json.endpoints : undefined;
    const api = typeof endpoints === "object" && endpoints !== null && "api" in endpoints ? endpoints.api : undefined;
    if (typeof api !== "string" || !URL.canParse(api)) throw new Error(`${discoveryUrl.host} named no endpoints.api`);
    return new URL(api);
  }

  function upstreamBase(headers: Headers): Promise<URL> {
    if (options.upstream !== undefined) return Promise.resolve(options.upstream);
    const authorization = headers.get("authorization");
    if (authorization === null) return Promise.reject(new Error("the request has no Authorization header to discover the upstream with"));
    return cached(upstreams, createHash("sha256").update(authorization).digest("hex"), () => discover(authorization));
  }

  async function foldedBody(format: Format<object>, sessionId: string, bytes: ArrayBuffer): Promise<string | undefined> {
    try {
      const injection = await cached(injections, sessionId, () => injectionFor(sessionId));
      const body = rewriteBody(format, JSON.parse(new TextDecoder().decode(bytes)) as JsonObject, injection);
      return body === undefined ? undefined : JSON.stringify(body);
    } catch {
      return undefined;
    }
  }

  async function forward(request: Request, path: string, search: string, target: Route): Promise<{ response: Response; folded: boolean }> {
    let base: URL;
    try {
      base = await upstreamBase(request.headers);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { response: new Response(`agent-fold: no Copilot API upstream: ${reason}\n`, { status: 502 }), folded: false };
    }
    let body: BodyInit | null = request.body;
    let folded = false;
    if (target.kind === "fold") {
      const bytes = await request.arrayBuffer();
      const rewritten = await foldedBody(target.format, target.sessionId, bytes);
      folded = rewritten !== undefined;
      body = rewritten ?? bytes;
    }
    const url = new URL(`${base.origin}${base.pathname.replace(/\/$/, "")}${path}${search}`);
    const upstream = await fetch(url, {
      method: request.method,
      headers: forwardHeaders(request.headers, folded),
      body,
      signal: request.signal,
      redirect: "manual",
    });
    return {
      response: new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders(upstream.headers),
      }),
      folded,
    };
  }

  function status(url: URL): Response {
    const nonce = url.searchParams.get("nonce");
    if (!nonce) return new Response("agent-fold: nonce required\n", { status: 400 });
    const launch = url.searchParams.get("launch");
    const session = url.searchParams.get("session");
    const lastSeen = session === null ? undefined : sessionLastSeen.get(session.toLowerCase());
    return Response.json({
      protocol: PROTOCOL,
      proof: proof(secret, nonce),
      launchSeen: launch !== null && launches.has(launch.toLowerCase()),
      sessionSeen: lastSeen !== undefined && lastSeen >= Number(url.searchParams.get("since") ?? Number.NaN),
    });
  }

  async function handle(request: Request, port: number): Promise<{ response: Response; folded: boolean }> {
    const url = new URL(request.url);
    const { path, launch } = stripLaunch(url.pathname);
    const target = route(request.method, path, request.headers, port);
    if (target.kind === "forbidden") return { response: new Response("agent-fold: forbidden host\n", { status: 403 }), folded: false };
    if (launch !== undefined) launches.add(launch);
    const sessionId = request.headers.get("x-client-session-id");
    if (sessionId !== null && UUID.test(sessionId)) sessionLastSeen.set(sessionId.toLowerCase(), Date.now());
    if (target.kind === "status") return { response: status(url), folded: false };
    if (target.kind === "rejectUpgrade") return { response: new Response(null, { status: 404 }), folded: false };
    return forward(request, path, url.search, target);
  }

  return Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    // Bun.serve closes a connection after 10 s without traffic by default, and a model can think longer than that before its first token.
    idleTimeout: 0,
    async fetch(request, server) {
      const path = stripLaunch(new URL(request.url).pathname).path;
      let status = 502;
      let folded = false;
      try {
        const handled = await handle(request, server.port ?? 0);
        status = handled.response.status;
        folded = handled.folded;
        return handled.response;
      } catch (error) {
        return new Response(`agent-fold: upstream request failed: ${error instanceof Error ? error.message : error}\n`, { status: 502 });
      } finally {
        const interaction = request.headers.get("x-interaction-type") ?? "-";
        console.error(`${new Date().toISOString()} ${request.method} ${path} ${status} ${interaction} ${folded ? "folded" : "unfolded"}`);
      }
    },
  });
}
