import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CopilotClient, type CopilotRequestContext, CopilotRequestHandler, type CopilotSession } from "@github/copilot-sdk";
import rulesTemplate from "./context/fold.md" with { type: "text" };
import { type Injection, rewriteBody } from "./fold";
import { findProjectRoot, foldDir, withFoldDir } from "./fold-dir";
import { formats } from "./formats";
import { indexMessage } from "./session-index";
import { conversationRoot, sessionStateDir } from "./session-root";

const SETUP_WAIT_MS = 5000;
const LEFT_LAUNCH_JOIN_DELAY_MS = 1000;

const foldHome = process.env.AGENT_FOLD_HOME || join(homedir(), ".agent-fold");

function readIndex(dir: string): string {
  try {
    return readFileSync(join(dir, "INDEX.md"), "utf8");
  } catch {
    return "";
  }
}

async function injectionFor(session: CopilotSession, sessionId: string): Promise<Injection> {
  const snapshot = await session.rpc.metadata.snapshot();
  const { startTime, sessionId: rootId } = conversationRoot(sessionStateDir, sessionId) ?? { startTime: snapshot.startTime, sessionId };
  const projectRoot = await findProjectRoot(snapshot.workingDirectory);
  const dir = foldDir({ foldHome, projectRoot, startTime, sessionId: rootId });
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

function settledWithin<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  const { promise: timeout, resolve } = Promise.withResolvers<undefined>();
  const timer = setTimeout(resolve, ms);
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class FoldHandler extends CopilotRequestHandler {
  readonly sessions = new Map<string, Promise<Injection | undefined>>();

  protected async sendRequest(request: Request, ctx: CopilotRequestContext): Promise<Response> {
    let forwarded = request;
    try {
      forwarded = (await this.folded(request, ctx)) ?? request;
    } catch {}
    return super.sendRequest(forwarded, ctx);
  }

  private async folded(request: Request, ctx: CopilotRequestContext): Promise<Request | undefined> {
    const format = formats[new URL(ctx.url).pathname];
    if (format === undefined || ctx.interactionType !== "conversation-agent") return undefined;
    if ((request.headers.get("content-encoding") ?? "identity") !== "identity") return undefined;
    const setup = ctx.sessionId === undefined ? undefined : this.sessions.get(ctx.sessionId);
    if (setup === undefined) return undefined;
    const injection = await settledWithin(setup, SETUP_WAIT_MS);
    if (injection === undefined) return undefined;
    const body = rewriteBody(format, await request.clone().json(), injection);
    if (body === undefined) return undefined;
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return new Request(request.url, { method: request.method, headers, body: JSON.stringify(body), signal: request.signal });
  }
}

const launchSessionId = process.env.SESSION_ID;
if (!launchSessionId) process.exit(0);

const handler = new FoldHandler();
const client = new CopilotClient({ _internalConnection: { kind: "parent-process" }, requestHandler: handler });
try {
  await mkdir(foldHome, { recursive: true });
  await client.start();
} catch (error) {
  console.error(`agent-fold: this extension process does not fold: ${error instanceof Error ? error.message : error}`);
  process.exit(0);
}

function keepFoldHomeGranted(session: CopilotSession, sessionId: string): void {
  const { paths } = session.rpc.permissions;
  const grant = () =>
    paths
      .isPathWithinAllowedDirectories({ path: foldHome })
      .then(({ allowed }) => allowed || paths.add({ path: foldHome }))
      .catch(error => console.error(`agent-fold: could not grant ${foldHome} to session ${sessionId}: ${error}`));
  // Copilot CLI 1.0.100: when the TUI switches back to a session it replaces the session's additional directories within about 30 ms after session.foreground, then reloads the session's agents and skills.
  session.on("session.custom_agents_updated", grant);
  session.on("session.skills_loaded", grant);
}

const joins: Promise<CopilotSession>[] = [];
let stopping = false;

function foldSession(sessionId: string): void {
  if (stopping || handler.sessions.has(sessionId)) return;
  const join = client.resumeSessionForExtension(sessionId, { additionalDirectories: [foldHome], suppressResumeEvent: true }, {}, undefined);
  joins.push(join);
  handler.sessions.set(
    sessionId,
    join
      .then(session => {
        keepFoldHomeGranted(session, sessionId);
        return injectionFor(session, sessionId);
      })
      .catch(error => {
        console.error(`agent-fold: not folding session ${sessionId}, requests pass through: ${error}`);
        return undefined;
      }),
  );
}

const connection = client.connection;
if (connection === null) {
  console.error("agent-fold: Copilot client has no connection after start, requests pass through");
} else {
  // Copilot CLI 1.0.96: a client the extension builds itself always sends requestPermission:true, which shows a load dialog and hangs -p without --allow-all-tools.
  const send = connection.sendRequest.bind(connection);
  connection.sendRequest = (method, params, ...rest) =>
    send(method, method === "session.resume" ? { ...(params as object), requestPermission: false } : params, ...rest);
  foldSession(launchSessionId);
  let foreground = launchSessionId;
  client.onLifecycle("session.foreground", ({ sessionId }) => {
    const leftLaunchSession = foreground === launchSessionId;
    foreground = sessionId;
    // Copilot CLI 1.0.100: /clear closes the session it leaves within about 100 ms of this event, which stops this process when that is the launch session, and a session joined by a provider that then dies hangs.
    if (leftLaunchSession) setTimeout(foldSession, LEFT_LAUNCH_JOIN_DELAY_MS, sessionId);
    else foldSession(sessionId);
  });
  // Copilot CLI 1.0.100: a session stays loaded while this connection holds it, so detaching lets a later /resume reload it without the dead provider.
  process.once("SIGTERM", () => {
    stopping = true;
    Promise.allSettled(joins.map(join => join.then(session => session.disconnect()))).then(() => process.exit(0));
  });
}
