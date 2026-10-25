import { readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCompactionGate } from "./compaction";
import { foldView, runStarts } from "./fold";
import { findProjectRoot, foldDir, withFoldDir } from "./fold-dir";
import { capIndex, type IndexSnapshot, withSessionIndex } from "./session-index";
import { foldOn, registerFoldCommand } from "./switch";

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLD_RULES = readFileSync(join(HERE, "context", "fold.md"), "utf8");
const FOLD_HOME = process.env.AGENT_FOLD_HOME || join(homedir(), ".agent-fold");

export const RULES_SECTION = "agent-fold";

export default function foldIn(pi: ExtensionAPI) {
  let snapshot: (IndexSnapshot & { anchor?: number }) | undefined;

  registerFoldCommand(pi);
  registerCompactionGate(pi);

  pi.on("context", async (event, ctx) => {
    try {
      if (!foldOn(ctx)) return undefined;
      const view = foldView(event.messages);
      if (!snapshot) return { messages: view };
      snapshot.anchor ??= view[runStarts(view).at(-1) ?? view.length]?.timestamp;
      return { messages: snapshot.anchor === undefined ? view : withSessionIndex(view, snapshot, snapshot.anchor) };
    } catch {
      return undefined;
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    snapshot = undefined;
    delete event.systemPromptOptions.sections[RULES_SECTION];
    if (!foldOn(ctx)) return undefined;
    try {
      const header = ctx.sessionManager.getHeader();
      if (!header) return undefined;
      const session = { id: ctx.sessionManager.getSessionId(), timestamp: header.timestamp };
      const dir = foldDir({ foldHome: FOLD_HOME, projectRoot: await findProjectRoot(ctx.sessionManager.getCwd()), session });
      await mkdir(dir, { recursive: true }).catch(() => undefined);
      const text = await readFile(join(dir, "INDEX.md"), "utf8").catch(() => "");
      snapshot = { dir, text: capIndex(text) };
      event.systemPromptOptions.sections[RULES_SECTION] = withFoldDir(FOLD_RULES, dir);
    } catch {
      snapshot = undefined;
    }
    return undefined;
  });
}
