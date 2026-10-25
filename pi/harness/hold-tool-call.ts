import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function holdToolCall(pi: ExtensionAPI) {
  pi.on("tool_call", async (_event, ctx) => {
    const signal = ctx.signal;
    if (!signal || signal.aborted) return undefined;
    const { promise, resolve } = Promise.withResolvers<void>();
    signal.addEventListener("abort", () => resolve(), { once: true });
    writeFileSync(process.env.HOLD_MARK ?? "", "held");
    await promise;
    return undefined;
  });
}
