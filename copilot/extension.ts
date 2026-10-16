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

const SETUP_WAIT_MS = 5000;

const foldHome = process.env.AGENT_FOLD_HOME || join(homedir(), ".agent-fold");

function readIndex(dir: string): string {
  try {
    return readFileSync(join(dir, "INDEX.md"), "utf8");
  } catch {
    return "";
  }
}

async function injectionFor(session: CopilotSession, sessionId: string): Promise<Injection> {
  const { startTime, workingDirectory } = await session.rpc.metadata.snapshot();
  const dir = foldDir({ foldHome, projectRoot: await findProjectRoot(workingDirectory), startTime, sessionId });
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
  injection: Promise<Injection | undefined> = Promise.resolve(undefined);

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
    const injection = await settledWithin(this.injection, SETUP_WAIT_MS);
    if (injection === undefined) return undefined;
    const body = rewriteBody(format, await request.clone().json(), injection);
    if (body === undefined) return undefined;
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return new Request(request.url, { method: request.method, headers, body: JSON.stringify(body), signal: request.signal });
  }
}

const sessionId = process.env.SESSION_ID;
try {
  if (!sessionId) throw new Error("SESSION_ID is not set");
  await mkdir(foldHome, { recursive: true });
  const handler = new FoldHandler();
  const client = new CopilotClient({ _internalConnection: { kind: "parent-process" }, requestHandler: handler });
  await client.start();
  const connection = client.connection;
  if (connection === null) throw new Error("Copilot client has no connection after start");
  // Copilot CLI 1.0.96: a client the extension builds itself always sends requestPermission:true, which shows a load dialog and hangs -p without --allow-all-tools.
  const send = connection.sendRequest.bind(connection);
  connection.sendRequest = (method, params, ...rest) =>
    send(method, method === "session.resume" ? { ...(params as object), requestPermission: false } : params, ...rest);
  const session = await client.resumeSessionForExtension(
    sessionId,
    { additionalDirectories: [foldHome], suppressResumeEvent: true },
    {},
    undefined,
  );
  handler.injection = injectionFor(session, sessionId).catch(error => {
    console.error(`agent-fold: fold dir setup failed, requests pass through: ${error}`);
    return undefined;
  });
} catch (error) {
  console.error(`agent-fold: not folding session ${sessionId}: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
