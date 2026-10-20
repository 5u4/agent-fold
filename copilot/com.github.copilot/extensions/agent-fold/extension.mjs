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
var statePath = join(proxyDir, "proxy.json");
var logPath = join(proxyDir, "proxy.log");
var sessionStateDir = join(process.env.COPILOT_HOME || join(home, ".copilot"), "session-state");

// proxy-state.ts
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
var STATUS_PATH = "/_agent-fold/status";
function readSecret() {
  try {
    return readFileSync(secretPath, "utf8").trim() || undefined;
  } catch {
    return;
  }
}
function proof(secret, nonce) {
  return createHmac("sha256", secret).update(nonce).digest("hex");
}
function isCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function readState() {
  try {
    const { protocol, pid, port } = JSON.parse(readFileSync(statePath, "utf8"));
    return isCount(protocol) && isCount(pid) && isCount(port) ? { protocol, pid, port } : undefined;
  } catch {
    return;
  }
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
  if (query.session !== undefined)
    url.searchParams.set("session", query.session);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok)
      return;
    const status = await response.json();
    if (typeof status?.proof !== "string" || !sameHex(status.proof, proof(secret, nonce)))
      return;
    if (typeof status.protocol !== "number")
      return;
    return { protocol: status.protocol, launchSeen: status.launchSeen === true, sessionSeen: status.sessionSeen === true };
  } catch {
    return;
  }
}

// extension.ts
var BYPASS_WARNING = "This session's model requests do not go through the agent-fold proxy, so its runs are not folded; start Copilot with `agent-fold copilot` or the app with `agent-fold gh-app`.";
function keepFoldHomeGranted(session) {
  const { paths } = session.rpc.permissions;
  const grant = () => paths.isPathWithinAllowedDirectories({ path: foldHome }).then(({ allowed }) => allowed || paths.add({ path: foldHome })).catch((error) => console.error(`agent-fold: could not grant ${foldHome} to session ${session.sessionId}: ${error}`));
  session.on("session.custom_agents_updated", grant);
  session.on("session.skills_loaded", grant);
}
async function routedThroughProxy(sessionId) {
  const state = readState();
  const secret = readSecret();
  if (state === undefined || secret === undefined)
    return false;
  return (await queryProxy(state.port, secret, { session: sessionId }))?.sessionSeen === true;
}
function warnOnBypass(session) {
  const stop = session.on("session.idle", () => {
    stop();
    routedThroughProxy(session.sessionId).then((routed) => routed ? undefined : session.log(BYPASS_WARNING, { level: "warning", ephemeral: true })).catch((error) => console.error(`agent-fold: could not check the proxy for session ${session.sessionId}: ${error}`));
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
