import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { proxyDir, secretPath } from "./paths";

export const PROTOCOL = 1;

export const STATUS_PATH = "/_agent-fold/status";

export type ProxyState = { protocol: number; pid: number; port: number };

export type ProxyStatus = { protocol: number; launchSeen: boolean; sessionSeen: boolean };

type Claim = { epoch: number } | { owner: ProxyState };

const EPOCH_FILE = /^proxy-(\d+)\.json$/;

function ensureProxyDir(): void {
  mkdirSync(proxyDir, { recursive: true, mode: 0o700 });
  chmodSync(proxyDir, 0o700);
}

function writePrivate(path: string, text: string): string {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, text, { flag: "wx", mode: 0o600 });
  return tmp;
}

function linked(tmp: string, path: string): boolean {
  try {
    linkSync(tmp, path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return false;
    throw error;
  }
}

export function ensureSecret(): string {
  const existing = readSecret();
  if (existing !== undefined) return existing;
  ensureProxyDir();
  const secret = randomBytes(32).toString("hex");
  const tmp = writePrivate(secretPath, secret);
  try {
    return linked(tmp, secretPath) ? secret : readFileSync(secretPath, "utf8").trim();
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function readSecret(): string | undefined {
  try {
    return readFileSync(secretPath, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function proof(secret: string, nonce: string): string {
  return createHmac("sha256", secret).update(nonce).digest("hex");
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function epochPath(epoch: number): string {
  return join(proxyDir, `proxy-${epoch}.json`);
}

function epochs(): number[] {
  try {
    return readdirSync(proxyDir)
      .flatMap(name => {
        const match = EPOCH_FILE.exec(name);
        return match === null ? [] : [Number(match[1])];
      })
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

function readEpoch(epoch: number): ProxyState | undefined {
  try {
    const { protocol, pid, port } = JSON.parse(readFileSync(epochPath(epoch), "utf8"));
    return isCount(protocol) && isCount(pid) && isCount(port) ? { protocol, pid, port } : undefined;
  } catch {
    return undefined;
  }
}

export function readState(): ProxyState | undefined {
  const [latest] = epochs();
  return latest === undefined ? undefined : readEpoch(latest);
}

async function serves(state: ProxyState, secret: string): Promise<boolean> {
  return (await queryProxy(state.port, secret, {}))?.protocol === PROTOCOL;
}

export async function liveState(secret: string): Promise<ProxyState | undefined> {
  const state = readState();
  return state !== undefined && (await serves(state, secret)) ? state : undefined;
}

export async function claimState(state: ProxyState, secret: string): Promise<Claim> {
  ensureProxyDir();
  const tmp = writePrivate(join(proxyDir, "proxy"), JSON.stringify(state));
  try {
    for (;;) {
      const [latest = 0] = epochs();
      const owner = readEpoch(latest);
      if (owner !== undefined && (await serves(owner, secret))) return { owner };
      const epoch = latest + 1;
      if (!linked(tmp, epochPath(epoch))) continue;
      const [newest, ...older] = epochs();
      if (newest === epoch) {
        for (const stale of older) rmSync(epochPath(stale), { force: true });
        return { epoch };
      }
      rmSync(epochPath(epoch), { force: true });
    }
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function removeState(epoch: number): void {
  rmSync(epochPath(epoch), { force: true });
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export async function queryProxy(
  port: number,
  secret: string,
  query: { launch?: string; session?: { id: string; since: number } },
  timeoutMs = 1000,
): Promise<ProxyStatus | undefined> {
  const nonce = randomBytes(16).toString("hex");
  const url = new URL(`http://127.0.0.1:${port}${STATUS_PATH}`);
  url.searchParams.set("nonce", nonce);
  if (query.launch !== undefined) url.searchParams.set("launch", query.launch);
  if (query.session !== undefined) {
    url.searchParams.set("session", query.session.id);
    url.searchParams.set("since", String(query.session.since));
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return undefined;
    const status = await response.json();
    if (typeof status?.proof !== "string" || !sameHex(status.proof, proof(secret, nonce))) return undefined;
    if (typeof status.protocol !== "number") return undefined;
    return { protocol: status.protocol, launchSeen: status.launchSeen === true, sessionSeen: status.sessionSeen === true };
  } catch {
    return undefined;
  }
}
