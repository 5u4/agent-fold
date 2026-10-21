#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { constants } from "node:os";
import { type Config, readConfig, type Target } from "./config";
import { configPath, foldHome, logPath, sessionStateDir } from "./paths";
import { startProxy } from "./proxy";
import { claimState, ensureSecret, liveState, PROTOCOL, type ProxyState, queryProxy, removeState } from "./proxy-state";

const USAGE = "usage: agent-fold proxy | agent-fold copilot [args...] | agent-fold gh-app [args...]";

const START_TIMEOUT_MS = 5000;

const LAUNCH_TIMEOUT_MS = 15000;

const POLL_MS = 100;

class ExitError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
  }
}

export async function ensureProxy(): Promise<ProxyState> {
  const secret = ensureSecret();
  const running = await liveState(secret);
  if (running !== undefined) return running;
  const log = openSync(logPath, "a", 0o600);
  try {
    spawn(process.execPath, [import.meta.path, "proxy"], { detached: true, stdio: ["ignore", log, log] }).unref();
  } finally {
    closeSync(log);
  }
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await Bun.sleep(POLL_MS);
    const started = await liveState(secret);
    if (started !== undefined) return started;
  }
  throw new ExitError(`agent-fold: the proxy did not start within ${START_TIMEOUT_MS / 1000} s; see ${logPath}`, 1);
}

async function checkInheritedApiUrl(secret: string): Promise<void> {
  const inherited = process.env.COPILOT_API_URL;
  if (!inherited) return;
  const url = URL.canParse(inherited) ? new URL(inherited) : undefined;
  const local = url?.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost") && url.port !== "";
  if (local && (await queryProxy(Number(url.port), secret, {})) !== undefined) return;
  throw new ExitError(`agent-fold: COPILOT_API_URL is already set to ${inherited}; set "upstream" in ${configPath} instead`, 2);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(command, args, { stdio: "inherit", env });
  const forward = () => child.kill("SIGTERM");
  process.on("SIGTERM", forward);
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  child.once("error", error => {
    process.off("SIGTERM", forward);
    reject(error);
  });
  child.once("exit", (code, signal) => {
    process.off("SIGTERM", forward);
    resolve(code ?? 128 + (signal === null ? 0 : constants.signals[signal]));
  });
  return promise;
}

async function waitForLaunch(port: number, secret: string, launch: string): Promise<boolean> {
  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await queryProxy(port, secret, { launch }))?.launchSeen) return true;
    await Bun.sleep(POLL_MS * 5);
  }
  return false;
}

async function launch(target: Target, config: Config, args: string[]): Promise<number> {
  const argv = config.launch[target];
  if (argv === undefined)
    throw new ExitError(`agent-fold: no default command opens the GitHub Copilot app here; set launch.${target} in ${configPath}`, 2);
  const secret = ensureSecret();
  await checkInheritedApiUrl(secret);
  const { port } = await ensureProxy();
  const launchId = randomUUID();
  const env = { ...process.env, COPILOT_API_URL: `http://127.0.0.1:${port}/launch/${launchId}` };
  const [command, ...commandArgs] = argv;
  if (target === "copilot") {
    process.on("SIGINT", () => {});
    return run(command, [...commandArgs, ...args], env);
  }
  const child = run(command, [...commandArgs, ...args], env);
  const seen = waitForLaunch(port, secret, launchId);
  seen.then(
    reached =>
      reached ||
      console.error(
        `agent-fold: no request from the GitHub Copilot app reached agent-fold within ${LAUNCH_TIMEOUT_MS / 1000} s. The app may already be running: quit it and run this again. Otherwise the launch command dropped COPILOT_API_URL.`,
      ),
  );
  const code = await child;
  if (code !== 0) return code;
  return (await seen) ? 0 : 1;
}

async function serveProxy(): Promise<void> {
  const secret = ensureSecret();
  const { upstream } = readConfig();
  const server = startProxy({ upstream, secret, foldHome, sessionStateDir });
  const port = server.port ?? 0;
  console.error(`${new Date().toISOString()} agent-fold proxy ${process.pid} listening on 127.0.0.1:${port}`);
  const claim = await claimState({ protocol: PROTOCOL, pid: process.pid, port }, secret);
  if ("owner" in claim) {
    console.error(
      `${new Date().toISOString()} agent-fold proxy ${process.pid} exits: proxy ${claim.owner.pid} already serves 127.0.0.1:${claim.owner.port}`,
    );
    process.exit(0);
  }
  const stop = () => {
    removeState(claim.epoch);
    process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

async function main([command, ...args]: string[]): Promise<void> {
  if (command === "proxy" && args.length === 0) return serveProxy();
  if (command === "copilot" || command === "gh-app") process.exit(await launch(command, readConfig(), args));
  console.error(USAGE);
  process.exit(2);
}

if (import.meta.main) {
  await main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof ExitError ? error.message : `agent-fold: ${error instanceof Error ? error.message : error}`);
    process.exit(error instanceof ExitError ? error.code : 1);
  });
}
