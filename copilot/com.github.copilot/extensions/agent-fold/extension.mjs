// extension.ts
import { mkdir } from "node:fs/promises";
import { joinSession } from "@github/copilot-sdk/extension";

// paths.ts
import { homedir } from "node:os";
import { join } from "node:path";
var home = homedir();
var foldHome = process.env.AGENT_FOLD_HOME || join(home, ".agent-fold");
var configPath = join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "agent-fold", "copilot.json");
var proxyDir = join(process.env.XDG_STATE_HOME || join(home, ".local", "state"), "agent-fold", "copilot-proxy");
var secretPath = join(proxyDir, "secret");
var logPath = join(proxyDir, "proxy.log");
var sessionStateDir = join(process.env.COPILOT_HOME || join(home, ".copilot"), "session-state");

// proxy-state.ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join as join2 } from "node:path";
var STATUS_PATH = "/_agent-fold/status";
var EPOCH_FILE = /^proxy-(\d+)\.json$/;
function readSecret() {
  try {
    return readFileSync(secretPath, "utf8").trim() || undefined;
  } catch {
    return;
  }
}
function proof(secret, nonce, port, status) {
  const signed = JSON.stringify([nonce, port, status.protocol, status.launchSeen, status.sessionSeen]);
  return createHmac("sha256", secret).update(signed).digest("hex");
}
function isCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function epochPath(epoch) {
  return join2(proxyDir, `proxy-${epoch}.json`);
}
function epochs() {
  try {
    return readdirSync(proxyDir).flatMap((name) => {
      const match = EPOCH_FILE.exec(name);
      return match === null ? [] : [Number(match[1])];
    }).sort((a, b) => b - a);
  } catch {
    return [];
  }
}
function readEpoch(epoch) {
  try {
    const { protocol, pid, port } = JSON.parse(readFileSync(epochPath(epoch), "utf8"));
    return isCount(protocol) && isCount(pid) && isCount(port) ? { protocol, pid, port } : undefined;
  } catch {
    return;
  }
}
function readState() {
  const [latest] = epochs();
  return latest === undefined ? undefined : readEpoch(latest);
}
function sameHex(a, b) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}
async function queryProxy(port, secret, query, timeoutMs = 1000) {
  const nonce = randomBytes(16).toString("hex");
  const url = new URL(`http://127.0.0.1:${port}${STATUS_PATH}`);
  url.searchParams.set("nonce", nonce);
  if (query.launch !== undefined)
    url.searchParams.set("launch", query.launch);
  if (query.session !== undefined) {
    url.searchParams.set("session", query.session.id);
    url.searchParams.set("since", String(query.session.since));
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok)
      return;
    const { proof: received, protocol, launchSeen, sessionSeen } = await response.json();
    if (typeof received !== "string" || typeof protocol !== "number" || typeof launchSeen !== "boolean" || typeof sessionSeen !== "boolean")
      return;
    const status = { protocol, launchSeen, sessionSeen };
    return sameHex(received, proof(secret, nonce, port, status)) ? status : undefined;
  } catch {
    return;
  }
}

// turn-start.ts
function turnStart(events) {
  for (const event of events.toReversed()) {
    if (event.type === "session.start" || event.type === "session.resume")
      return;
    if (event.type === "user.message" && !event.agentId)
      return Date.parse(event.timestamp);
  }
  return;
}

// extension.ts
var BYPASS_WARNING = "This session's model requests do not go through the agent-fold proxy, so its runs are not folded; start Copilot with `agent-fold copilot` or the app with `agent-fold gh-app`.";
function keepFoldHomeGranted(session) {
  const { paths } = session.rpc.permissions;
  const grant = () => paths.isPathWithinAllowedDirectories({ path: foldHome }).then(({ allowed }) => allowed || paths.add({ path: foldHome })).catch((error) => console.error(`agent-fold: could not grant ${foldHome} to session ${session.sessionId}: ${error}`));
  session.on("session.custom_agents_updated", grant);
  session.on("session.skills_loaded", grant);
}
async function routedThroughProxy(sessionId, since) {
  const state = readState();
  const secret = readSecret();
  if (state === undefined || secret === undefined)
    return false;
  return (await queryProxy(state.port, secret, { session: { id: sessionId, since } }))?.sessionSeen === true;
}
function warnOnBypass(session) {
  const stop = session.on("session.idle", () => {
    session.getEvents().then(async (events) => {
      const since = turnStart(events);
      if (since === undefined)
        return;
      stop();
      if (!await routedThroughProxy(session.sessionId, since))
        await session.log(BYPASS_WARNING, { level: "warning", ephemeral: true });
    }).catch((error) => {
      stop();
      console.error(`agent-fold: could not check the proxy for session ${session.sessionId}: ${error}`);
    });
  });
}
if (!process.env.SESSION_ID)
  process.exit(0);
try {
  await mkdir(foldHome, { recursive: true });
  const session = await joinSession({ additionalDirectories: [foldHome] });
  keepFoldHomeGranted(session);
  warnOnBypass(session);
} catch (error) {
  console.error(`agent-fold: could not join the session: ${error instanceof Error ? error.message : error}`);
}
