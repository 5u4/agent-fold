import { mkdir } from "node:fs/promises";
import type { JsonObject } from "../fold";
import { sessionFoldDir } from "../fold-dir";
import { DEFAULT_DISCOVERY_URL, FOLDED_INTERACTIONS, forwardTo, upstreamDiscovery } from "../proxy";
import { awaitConversationRoot, SESSION_START_WAIT_MS } from "../session-root";
import { isModelPath, type ModelPath } from "./model-input";
import { offeredTools, translateStep } from "./script";
import { scriptedResponse } from "./sse";
import type { ScriptStep } from "./types";

export type ModelRequest = { sessionId: string; interactionType: string; path: ModelPath; body: JsonObject };

export type ScriptOutcome = { unconsumed: ScriptStep[]; errors: string[] };

export type Upstream = {
  url: URL;
  requests: readonly ModelRequest[];
  arm(steps: ScriptStep[]): void;
  disarm(): ScriptOutcome;
  stop(): void;
};

type Script = { steps: ScriptStep[]; used: number; errors: string[] };

export function startUpstream({
  workdir,
  foldHome,
  sessionStateDir,
}: {
  workdir: string;
  foldHome: string;
  sessionStateDir: string;
}): Upstream {
  const discoverUpstream = upstreamDiscovery(DEFAULT_DISCOVERY_URL);
  const foldDirs = new Map<string, Promise<string>>();
  const requests: ModelRequest[] = [];
  let script: Script | undefined;

  async function createFoldDir(sessionId: string): Promise<string> {
    const dir = await sessionFoldDir(foldHome, await awaitConversationRoot(sessionStateDir, sessionId, SESSION_START_WAIT_MS));
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async function answer(armed: Script, request: ModelRequest): Promise<Response> {
    if (armed.errors.length === 0 && armed.used === armed.steps.length) {
      armed.errors.push(`a ${request.interactionType} request arrived after all ${armed.steps.length} script steps were used`);
    }
    if (armed.errors.length > 0) return new Response(`agent-fold eval: ${armed.errors.join("; ")}\n`, { status: 500 });
    const step = armed.steps[armed.used++];
    try {
      const foldDir = foldDirs.get(request.sessionId) ?? createFoldDir(request.sessionId);
      foldDirs.set(request.sessionId, foldDir);
      const output = translateStep(step, { tools: offeredTools(request.path, request.body), workdir, foldDir: await foldDir });
      if (typeof request.body.model !== "string") throw new Error(`${request.path} request body model is not a string`);
      return scriptedResponse(request.path, request.body.model, output);
    } catch (error) {
      armed.errors.push(error instanceof Error ? error.message : String(error));
      return new Response(`agent-fold eval: ${armed.errors.join("; ")}\n`, { status: 500 });
    }
  }

  async function handle(request: Request): Promise<Response> {
    if (request.headers.has("upgrade")) return new Response(null, { status: 404 });
    const url = new URL(request.url);
    const path = url.pathname;
    const interactionType = request.headers.get("x-interaction-type") ?? "";
    if (request.method !== "POST" || !isModelPath(path) || FOLDED_INTERACTIONS[interactionType] !== true) {
      return forwardTo(await discoverUpstream(request.headers), request, path, url.search, request.body, false);
    }
    const bytes = await request.arrayBuffer();
    const body = JSON.parse(new TextDecoder().decode(bytes));
    const modelRequest = { sessionId: request.headers.get("x-client-session-id") ?? "", interactionType, path, body };
    requests.push(modelRequest);
    if (script !== undefined) return answer(script, modelRequest);
    return forwardTo(await discoverUpstream(request.headers), request, path, url.search, bytes, false);
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      try {
        return await handle(request);
      } catch (error) {
        return new Response(`agent-fold eval upstream: ${error instanceof Error ? error.message : error}\n`, { status: 502 });
      }
    },
  });

  return {
    url: new URL(`http://127.0.0.1:${server.port}`),
    requests,
    arm(steps) {
      if (script !== undefined) throw new Error("the upstream is already armed");
      script = { steps, used: 0, errors: [] };
    },
    disarm() {
      if (script === undefined) throw new Error("the upstream is not armed");
      const outcome = { unconsumed: script.steps.slice(script.used), errors: script.errors };
      script = undefined;
      return outcome;
    },
    stop() {
      server.stop(true);
    },
  };
}
