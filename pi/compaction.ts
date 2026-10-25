import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { compact, type ExtensionAPI, estimateTokens, type SessionBeforeCompactEvent, shouldCompact } from "@earendil-works/pi-coding-agent";
import { foldSettled, foldView } from "./fold";
import { foldOn } from "./switch";

export type CompactionDecision = "cancel" | "fold-summary";

export function decideCompaction(
  reason: SessionBeforeCompactEvent["reason"],
  folded: AgentMessage[],
  contextWindow: number,
  settings: SessionBeforeCompactEvent["preparation"]["settings"],
): CompactionDecision {
  const tokens = folded.reduce((sum, message) => sum + estimateTokens(message), 0);
  return reason === "threshold" && !shouldCompact(tokens, contextWindow, settings) ? "cancel" : "fold-summary";
}

export function registerCompactionGate(pi: ExtensionAPI) {
  pi.on("session_before_compact", async (event, ctx) => {
    if (!foldOn(ctx)) return undefined;
    try {
      const model = ctx.model;
      if (!model) return undefined;
      const { preparation } = event;
      const folded = foldSettled(ctx.sessionManager.buildSessionProjection().messages);
      if (decideCompaction(event.reason, folded, model.contextWindow, preparation.settings) === "cancel") return { cancel: true };
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) return undefined;
      const compaction = await compact(
        {
          ...preparation,
          messagesToSummarize: foldSettled(preparation.messagesToSummarize),
          turnPrefixMessages: foldView(preparation.turnPrefixMessages),
        },
        auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model,
        auth.apiKey,
        auth.headers && Object.fromEntries(Object.entries(auth.headers).filter((entry): entry is [string, string] => entry[1] !== null)),
        event.customInstructions,
        event.signal,
        ctx.thinkingLevel,
        undefined,
        auth.env,
      );
      return { compaction };
    } catch {
      return undefined;
    }
  });
}
