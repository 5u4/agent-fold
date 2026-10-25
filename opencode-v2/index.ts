import { readFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Plugin } from "@opencode/plugin";
import { foldView, type LoopMessage, runTable, withIndex } from "./fold";
import { foldDir, withFoldDir } from "./fold-dir";
import { capIndex, indexMessage } from "./session-index";
import { foldEnabled, nextSwitch, parseSwitchArg, readSwitch, SWITCH_KEY } from "./switch";

const FOLD_RULES = readFileSync(new URL("./context/fold.md", import.meta.url), "utf8");

type SessionFold = { dir: string; rules: string; snapshot?: { start: string | undefined; index: LoopMessage } };

export default Plugin.define({
  id: "agent-fold",
  async setup(ctx) {
    const foldHome = process.env.AGENT_FOLD_HOME || join(homedir(), ".agent-fold");
    const sessions = new Map<string, SessionFold>();

    await ctx.command.transform(editor =>
      editor.add({
        name: "agent-fold",
        description: "Fold finished runs: on, off, or status",
        async execute({ sessionID, prompt }) {
          const arg = parseSwitchArg(prompt.text);
          const { metadata = {} } = await ctx.session.get({ sessionID });
          await ctx.session.update({
            sessionID,
            metadata: { ...metadata, [SWITCH_KEY]: nextSwitch(readSwitch(metadata), arg, Date.now()) },
          });
        },
      }),
    );

    await ctx.session.hook("context", async event => {
      try {
        const session = await ctx.session.get({ sessionID: event.sessionID });
        if (!foldEnabled(session.metadata)) return;
        const runs = runTable(await ctx.session.context({ sessionID: event.sessionID }));
        let fold = sessions.get(event.sessionID);
        if (!fold) {
          const dir = foldDir({
            foldHome,
            projectRoot: ctx.location.project.canonical,
            session: { id: event.sessionID, created: session.time.created },
          });
          fold = { dir, rules: withFoldDir(FOLD_RULES, dir) };
          sessions.set(event.sessionID, fold);
        }
        if (!fold.snapshot || fold.snapshot.start !== runs.start) {
          await mkdir(fold.dir, { recursive: true });
          const text = await readFile(join(fold.dir, "INDEX.md"), "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return "";
            throw error;
          });
          fold.snapshot = { start: runs.start, index: indexMessage(fold.dir, capIndex(text)) };
        }
        const messages = withIndex(foldView(event.messages, runs), runs, fold.snapshot.index);
        const system = [...event.system, { type: "text" as const, text: fold.rules }];
        event.messages = messages;
        event.system = system;
      } catch {}
    });
  },
});
