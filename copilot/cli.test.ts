import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = new URL("./cli.ts", import.meta.url).pathname;

type State = { protocol: number; pid: number; port: number };

let root: string;
let env: Record<string, string>;
const started = new Set<number>();

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-fold-cli-"));
  env = { ...process.env, XDG_STATE_HOME: join(root, "state"), XDG_CONFIG_HOME: join(root, "config"), AGENT_FOLD_HOME: join(root, "fold") };
});

afterEach(() => {
  for (const pid of started) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  started.clear();
  rmSync(root, { recursive: true, force: true });
});

const statePath = () => join(root, "state", "agent-fold", "copilot-proxy", "proxy.json");

async function ensureProxy(): Promise<State> {
  const proc = Bun.spawn(
    ["bun", "-e", `import { ensureProxy } from ${JSON.stringify(CLI)}; console.log(JSON.stringify(await ensureProxy()));`],
    {
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`ensureProxy failed: ${stderr}`);
  const state: State = JSON.parse(stdout);
  started.add(state.pid);
  return state;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("ensureProxy started twice reuses the one live proxy", async () => {
  const first = await ensureProxy();
  const second = await ensureProxy();
  expect(second).toEqual(first);
  expect(alive(first.pid)).toBe(true);
  expect(JSON.parse(readFileSync(statePath(), "utf8"))).toEqual(first);
});

test("a stale proxy.json naming a dead port gets a fresh proxy", async () => {
  const closed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const deadPort = closed.port ?? 0;
  closed.stop(true);
  mkdirSync(join(root, "state", "agent-fold", "copilot-proxy"), { recursive: true });
  writeFileSync(statePath(), JSON.stringify({ protocol: 1, pid: 999999, port: deadPort }));
  const fresh = await ensureProxy();
  expect(fresh.port).not.toBe(deadPort);
  expect(alive(fresh.pid)).toBe(true);
  expect(JSON.parse(readFileSync(statePath(), "utf8"))).toEqual(fresh);
});
