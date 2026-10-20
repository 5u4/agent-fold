import { homedir } from "node:os";
import { join } from "node:path";

const home = homedir();

export const foldHome = process.env.AGENT_FOLD_HOME || join(home, ".agent-fold");

export const configPath = join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "agent-fold", "copilot.json");

export const proxyDir = join(process.env.XDG_STATE_HOME || join(home, ".local", "state"), "agent-fold", "copilot-proxy");

export const secretPath = join(proxyDir, "secret");

export const statePath = join(proxyDir, "proxy.json");

export const logPath = join(proxyDir, "proxy.log");

export const sessionStateDir = join(process.env.COPILOT_HOME || join(home, ".copilot"), "session-state");
