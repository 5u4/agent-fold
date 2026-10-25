import {
  calculateContextTokens,
  compact,
  type ExtensionAPI,
  estimateTokens,
  type SessionBeforeCompactEvent,
  shouldCompact,
} from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { foldSettled, foldView } from "./fold";
import { foldOn } from "./switch";

export type CompactionDecision = "cancel" | "fold-summary";

export function foldedRequestTokens(messages: AgentMessage[]): number | undefined {
  const last = messages.findLastIndex(
    message =>
      message.role === "assistant" && message.stopReason !== "aborted" && message.stopReason !== "error" && calculateContextTokens(message.usage) > 0,
  );
  const measured = messages[last];
  if (measured?.role !== "assistant") return undefined;
  const sent = foldView(messages.slice(0, last + 1)).reduce((sum, message) => sum + estimateTokens(message), 0);
  const overhead = Math.max(0, calculateContextTokens(measured.usage) - sent);
  return foldSettled(messages).reduce((sum, message) => sum + estimateTokens(message), overhead);
}

export function decideCompaction(
  reason: SessionBeforeCompactEvent["reason"],
  tokens: number | undefined,
  contextWindow: number,
  settings: SessionBeforeCompactEvent["preparation"]["settings"],
): CompactionDecision {
  return reason === "threshold" && tokens !== undefined && !shouldCompact(tokens, contextWindow, settings) ? "cancel" : "fold-summary";
}

export function registerCompactionGate(pi: ExtensionAPI) {
  pi.on("session_before_compact", async (event, ctx) => {
    if (!foldOn(ctx)) return undefined;
    try {
      const model = ctx.model;
      if (!model) return undefined;
      const { preparation } = event;
      const tokens = foldedRequestTokens(ctx.sessionManager.buildSessionProjection().messages);
      if (decideCompaction(event.reason, tokens, model.contextWindow, preparation.settings) === "cancel") return { cancel: true };
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
