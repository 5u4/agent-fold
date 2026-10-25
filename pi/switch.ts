import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

export const SWITCH_ENTRY = "agent-fold.switch";

const ACTIONS = [
  { value: "on", label: "on", description: "Fold finished runs in this session" },
  { value: "off", label: "off", description: "Send this session unfolded, as without agent-fold" },
  { value: "status", label: "status", description: "Show whether folding is on in this session" },
];

function switchValue(entry: SessionEntry): boolean | undefined {
  if (entry.type !== "custom" || entry.customType !== SWITCH_ENTRY) return undefined;
  const data = entry.data;
  if (typeof data !== "object" || data === null || !("enabled" in data)) return undefined;
  return typeof data.enabled === "boolean" ? data.enabled : undefined;
}

export function foldEnabled(entries: readonly SessionEntry[]): boolean {
  for (let index = entries.length - 1; index >= 0; index--) {
    const enabled = switchValue(entries[index]);
    if (enabled !== undefined) return enabled;
  }
  return true;
}

export function foldOn(ctx: ExtensionContext): boolean {
  try {
    return foldEnabled(ctx.sessionManager.getBranch());
  } catch {
    return true;
  }
}

function report(enabled: boolean, changed: boolean, hasMessages: boolean): string {
  if (!changed) return `agent-fold is already ${enabled ? "on" : "off"} in this session.`;
  if (!hasMessages) return `agent-fold is now ${enabled ? "on" : "off"} in this session.`;
  return enabled
    ? "agent-fold is now on in this session. Earlier runs will be sent folded again."
    : "agent-fold is now off in this session. Earlier runs will be sent unfolded.";
}

export function registerFoldCommand(pi: ExtensionAPI) {
  pi.registerCommand("agent-fold", {
    description: "Turn agent-fold on or off for this session, or show its status",
    getArgumentCompletions: prefix => ACTIONS.filter(action => action.value.startsWith(prefix.trim())),
    async handler(args, ctx) {
      const action = args.trim() || "status";
      const current = foldOn(ctx);
      if (action === "status") {
        ctx.ui.notify(`agent-fold is ${current ? "on" : "off"} in this session.`, "info");
        return;
      }
      if (action !== "on" && action !== "off") {
        ctx.ui.notify(`Unknown argument "${action}". Use /agent-fold on, /agent-fold off, or /agent-fold status.`, "warning");
        return;
      }
      const enabled = action === "on";
      if (enabled !== current) pi.appendEntry(SWITCH_ENTRY, { enabled });
      const hasMessages = ctx.sessionManager.getBranch().some(entry => entry.type === "message" && entry.message.role !== "system");
      ctx.ui.notify(report(enabled, enabled !== current, hasMessages), "info");
    },
  });
}
