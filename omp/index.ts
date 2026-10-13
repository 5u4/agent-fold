import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { registerCompactionGate } from "./compaction";
import { foldView } from "./fold";

const FOLD_RULES = readFileSync(join(import.meta.dir, "context", "fold.md"), "utf8");
const MANAGED_SKILL_RULES = readFileSync(join(import.meta.dir, "context", "managed-skills.md"), "utf8");
const HIDDEN_TOOLS: Record<string, true> = { checkpoint: true, rewind: true };

export default function foldIn(pi: ExtensionAPI) {
  const settings = pi.pi.settings;

  async function hideCheckpointTools() {
    const active = pi.getActiveTools();
    if (active.some(name => Object.hasOwn(HIDDEN_TOOLS, name)))
      await pi.setActiveTools(active.filter(name => !Object.hasOwn(HIDDEN_TOOLS, name)));
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.agent?.kind === "main") await hideCheckpointTools();
  });

  registerCompactionGate(pi);

  pi.on("context", async (event, ctx) => {
    if (ctx.agent?.kind !== "main") return undefined;
    try {
      return { messages: foldView(event.messages) };
    } catch {
      return undefined;
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (ctx.agent?.kind !== "main") return undefined;
    await hideCheckpointTools();
    const managedSkills =
      lookup("autolearn.enabled")?.get(settings) === true && pi.getAllTools().some(tool => tool.name === "manage_skill");
    const rules = managedSkills ? `${FOLD_RULES}\n${MANAGED_SKILL_RULES}` : FOLD_RULES;
    return { systemPrompt: [...event.systemPrompt, rules] };
  });
}
