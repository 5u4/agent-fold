import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { proxyDir, secretPath, statePath } from "./paths";

export const PROTOCOL = 1;

export const STATUS_PATH = "/_agent-fold/status";

export type ProxyState = { protocol: number; pid: number; port: number };

export type ProxyStatus = { protocol: number; launchSeen: boolean; sessionSeen: boolean };

function ensureProxyDir(): void {
  mkdirSync(proxyDir, { recursive: true, mode: 0o700 });
  chmodSync(proxyDir, 0o700);
}

function writePrivate(path: string, text: string): string {
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, text, { flag: "wx", mode: 0o600 });
  return tmp;
}

export function ensureSecret(): string {
  const existing = readSecret();
  if (existing !== undefined) return existing;
  ensureProxyDir();
  const secret = randomBytes(32).toString("hex");
  const tmp = writePrivate(secretPath, secret);
  try {
    linkSync(tmp, secretPath);
    return secret;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    return readFileSync(secretPath, "utf8").trim();
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

export function readState(): ProxyState | undefined {
  try {
    const { protocol, pid, port } = JSON.parse(readFileSync(statePath, "utf8"));
    return isCount(protocol) && isCount(pid) && isCount(port) ? { protocol, pid, port } : undefined;
  } catch {
    return undefined;
  }
}

export function writeState(state: ProxyState): void {
  ensureProxyDir();
  renameSync(writePrivate(statePath, JSON.stringify(state)), statePath);
}

export function removeState(pid: number): void {
  if (readState()?.pid === pid) rmSync(statePath, { force: true });
}

function sameHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export async function queryProxy(
  port: number,
  secret: string,
  query: { launch?: string; session?: string },
  timeoutMs = 1000,
): Promise<ProxyStatus | undefined> {
  const nonce = randomBytes(16).toString("hex");
  const url = new URL(`http://127.0.0.1:${port}${STATUS_PATH}`);
  url.searchParams.set("nonce", nonce);
  if (query.launch !== undefined) url.searchParams.set("launch", query.launch);
  if (query.session !== undefined) url.searchParams.set("session", query.session);
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
