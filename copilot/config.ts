import { readFileSync } from "node:fs";
import { configPath } from "./paths";

export type Target = "copilot" | "gh-app";

export type Config = { upstream: URL | undefined; launch: Record<Target, readonly string[] | undefined> };

const TARGETS: readonly Target[] = ["copilot", "gh-app"];

function defaultLaunch(platform: NodeJS.Platform): Config["launch"] {
  return { copilot: ["copilot"], "gh-app": platform === "darwin" ? ["open", "-a", "GitHub Copilot"] : undefined };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(object: Record<string, unknown>, known: readonly string[], prefix: string): void {
  const unknown = Object.keys(object).find(key => !known.includes(key));
  if (unknown !== undefined) throw new Error(`${prefix}${unknown} is not a known key`);
}

function parseUpstream(value: unknown): URL | undefined {
  if (value === undefined) return undefined;
  const url = typeof value === "string" && URL.canParse(value) ? new URL(value) : undefined;
  if (url?.protocol !== "https:") throw new Error("upstream must be an https: URL");
  return url;
}

function parseArgv(value: unknown, key: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || !value.every(arg => typeof arg === "string" && arg !== "")) {
    throw new Error(`${key} must be a non-empty array of non-empty strings`);
  }
  return value;
}

export function parseConfig(json: unknown, platform: NodeJS.Platform = process.platform): Config {
  if (!isObject(json)) throw new Error("the config must be a JSON object");
  rejectUnknownKeys(json, ["upstream", "launch"], "");
  const launch = defaultLaunch(platform);
  if (json.launch !== undefined) {
    if (!isObject(json.launch)) throw new Error("launch must be an object");
    rejectUnknownKeys(json.launch, TARGETS, "launch.");
    for (const target of TARGETS) launch[target] = parseArgv(json.launch[target], `launch.${target}`) ?? launch[target];
  }
  return { upstream: parseUpstream(json.upstream), launch };
}

export function readConfig(path = configPath): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return parseConfig({});
    throw error;
  }
  try {
    return parseConfig(JSON.parse(text));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : error}`);
  }
}
