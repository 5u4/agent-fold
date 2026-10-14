import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { registerCompactionGate } from "./compaction";
import { foldView } from "./fold";
import { foldOn, registerFoldCommand } from "./switch";

const FOLD_RULES = readFileSync(join(import.meta.dir, "context", "fold.md"), "utf8");
const MANAGED_SKILL_RULES = readFileSync(join(import.meta.dir, "context", "managed-skills.md"), "utf8");
const HIDDEN_TOOLS: Record<string, true> = { checkpoint: true, rewind: true };

export default function foldIn(pi: ExtensionAPI) {
  const settings = pi.pi.settings;
  const hiddenTools = new Set<string>();

  async function syncCheckpointTools(enabled: boolean) {
    const active = pi.getActiveTools();
    if (!enabled) {
      if (hiddenTools.size === 0) return;
      await pi.setActiveTools([...new Set([...active, ...hiddenTools])]);
      hiddenTools.clear();
      return;
    }
    const hide = active.filter(name => Object.hasOwn(HIDDEN_TOOLS, name));
    if (hide.length === 0) return;
    for (const name of hide) hiddenTools.add(name);
    await pi.setActiveTools(active.filter(name => !Object.hasOwn(HIDDEN_TOOLS, name)));
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.agent?.kind === "main") await syncCheckpointTools(foldOn(ctx));
  });

  registerFoldCommand(pi, syncCheckpointTools);
  registerCompactionGate(pi);

  pi.on("context", async (event, ctx) => {
    if (ctx.agent?.kind !== "main" || !foldOn(ctx)) return undefined;
    try {
      return { messages: foldView(event.messages) };
    } catch {
      return undefined;
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (ctx.agent?.kind !== "main") return undefined;
    const enabled = foldOn(ctx);
    await syncCheckpointTools(enabled);
    if (!enabled) return undefined;
    const managedSkills =
      lookup("autolearn.enabled")?.get(settings) === true && pi.getAllTools().some(tool => tool.name === "manage_skill");
    const rules = managedSkills ? `${FOLD_RULES}\n${MANAGED_SKILL_RULES}` : FOLD_RULES;
    return { systemPrompt: [...event.systemPrompt, rules] };
  });
}
