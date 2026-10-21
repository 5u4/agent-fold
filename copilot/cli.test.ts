import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  for (const pid of loggedDaemons()) started.add(pid);
  for (const pid of started) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  started.clear();
  rmSync(root, { recursive: true, force: true });
});

const proxyDir = () => join(root, "state", "agent-fold", "copilot-proxy");

function published(): State {
  const [latest] = readdirSync(proxyDir())
    .flatMap(name => /^proxy-(\d+)\.json$/.exec(name)?.[1] ?? [])
    .map(Number)
    .sort((a, b) => b - a);
  return JSON.parse(readFileSync(join(proxyDir(), `proxy-${latest}.json`), "utf8"));
}

function loggedDaemons(): number[] {
  let log = "";
  try {
    log = readFileSync(join(proxyDir(), "proxy.log"), "utf8");
  } catch {}
  return [...log.matchAll(/agent-fold proxy (\d+) listening/g)].map(match => Number(match[1]));
}

async function livingDaemons(owner: number): Promise<number[]> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const living = loggedDaemons().filter(alive);
    if ((living.length === 1 && living[0] === owner) || Date.now() >= deadline) return living;
    // The daemons are detached grandchildren of the test, so nothing signals their exit to it.
    await Bun.sleep(100);
  }
}

async function launchTogether(count: number): Promise<State> {
  const states = await Promise.all(Array.from({ length: count }, () => ensureProxy()));
  const [owner] = states;
  expect(states).toEqual(Array(count).fill(owner));
  expect(published()).toEqual(owner);
  expect(await livingDaemons(owner.pid)).toEqual([owner.pid]);
  return owner;
}

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
  expect(published()).toEqual(first);
});

test("concurrent first launches agree on one proxy and leave no other daemon running", async () => {
  await launchTogether(8);
});

test("concurrent launches over a stale state naming a dead port agree on one fresh proxy", async () => {
  const closed = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const deadPort = closed.port ?? 0;
  closed.stop(true);
  mkdirSync(proxyDir(), { recursive: true });
  writeFileSync(join(proxyDir(), "proxy-1.json"), JSON.stringify({ protocol: 1, pid: 999999, port: deadPort }));
  const fresh = await launchTogether(8);
  expect(fresh.port).not.toBe(deadPort);
  expect(readdirSync(proxyDir()).filter(name => name.startsWith("proxy-"))).toEqual(["proxy-2.json"]);
});

test("SIGTERM to agent-fold copilot stops Copilot and exits with 143", async () => {
  mkdirSync(join(root, "config", "agent-fold"), { recursive: true });
  writeFileSync(
    join(root, "config", "agent-fold", "copilot.json"),
    JSON.stringify({ launch: { copilot: ["sh", "-c", "echo $$; exec sleep 30"] } }),
  );
  const launcher = Bun.spawn(["bun", CLI, "copilot"], { env, stdout: "pipe", stderr: "inherit" });
  const { value } = await launcher.stdout.getReader().read();
  const child = Number(new TextDecoder().decode(value));
  started.add(child);
  launcher.kill("SIGTERM");
  expect(await launcher.exited).toBe(143);
  expect(alive(child)).toBe(false);
});
