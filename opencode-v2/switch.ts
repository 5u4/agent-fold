export type FoldSwitch = { readonly enabled: boolean; readonly at: number };

export type SwitchArg = "on" | "off" | "status";

export const SWITCH_KEY = "agentFold";

export const USAGE = "usage: /agent-fold on|off|status";

export function readSwitch(metadata: Record<string, unknown> | undefined): FoldSwitch | undefined {
  const value = metadata?.[SWITCH_KEY];
  if (typeof value !== "object" || value === null) return undefined;
  const { enabled, at } = value as Record<string, unknown>;
  return typeof enabled === "boolean" && typeof at === "number" ? { enabled, at } : undefined;
}

export function foldEnabled(metadata: Record<string, unknown> | undefined): boolean {
  return readSwitch(metadata)?.enabled ?? true;
}

export function parseSwitchArg(text: string): SwitchArg {
  const arg = text.trim() || "status";
  if (arg === "on" || arg === "off" || arg === "status") return arg;
  throw new Error(USAGE);
}

export function nextSwitch(prev: FoldSwitch | undefined, arg: SwitchArg, now: number): FoldSwitch {
  return {
    enabled: arg === "status" ? (prev?.enabled ?? true) : arg === "on",
    at: Math.max(now, (prev?.at ?? 0) + 1),
  };
}

export function switchMessage(state: FoldSwitch): string {
  return `agent-fold: ${state.enabled ? "on" : "off"}`;
}
