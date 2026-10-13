import { compact, resolveThresholdTokens } from "@oh-my-pi/pi-agent-core/compaction";
import type { AutoCompactionStartEvent, ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { lookup } from "@oh-my-pi/pi-coding-agent/config/registry";
import { foldSettled, foldView } from "./fold";
import { foldOn } from "./switch";

export type AutoAttempt = Pick<AutoCompactionStartEvent, "reason" | "action">;
export type FoldedUsage = { tokens: number; threshold: number };
export type CompactionDecision = "native" | "cancel" | "fold-summary";

export function decideCompaction(attempt: AutoAttempt | undefined, usage: FoldedUsage | undefined): CompactionDecision {
  if (attempt?.reason === "threshold" && usage && usage.tokens <= usage.threshold) return "cancel";
  return attempt && attempt.action !== "shake" ? "fold-summary" : "native";
}

export function registerCompactionGate(pi: ExtensionAPI) {
  let attempt: AutoAttempt | undefined;

  pi.on("auto_compaction_start", async (event, ctx) => {
    if (ctx.agent?.kind === "main") attempt = { reason: event.reason, action: event.action };
  });

  pi.on("auto_compaction_end", async () => {
    attempt = undefined;
  });

  pi.on("session_before_compact", async (event, ctx) => {
    if (ctx.agent?.kind !== "main") return undefined;
    const pending = attempt;
    attempt = undefined;
    if (!foldOn(ctx)) return undefined;
    try {
      const { preparation } = event;
      const usage = ctx.getContextUsage();
      const folded = usage && {
        tokens: usage.tokens,
        threshold: resolveThresholdTokens(usage.contextWindow, preparation.settings),
      };
      const decision = decideCompaction(pending, folded);
      if (decision === "cancel") return { cancel: true };
      if (decision === "native" || lookup("secrets.enabled")?.get(pi.pi.settings) === true) return undefined;
      const model = ctx.model;
      if (!model) return undefined;
      const sessionId = ctx.sessionManager.getSessionId();
      if (!(await ctx.modelRegistry.getApiKey(model, sessionId))) return undefined;
      const compaction = await compact(
        {
          ...preparation,
          settings: { ...preparation.settings, remoteEnabled: false },
          messagesToSummarize: foldSettled(preparation.messagesToSummarize),
          turnPrefixMessages: foldView(preparation.turnPrefixMessages),
        },
        model,
        ctx.modelRegistry.resolver(model, sessionId),
        event.customInstructions,
        event.signal,
      );
      return { compaction };
    } catch {
      return undefined;
    }
  });
}
