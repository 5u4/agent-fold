import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function queueFollowUp(pi: ExtensionAPI) {
  let queued = false;
  pi.on("tool_call", async () => {
    if (queued) return undefined;
    queued = true;
    writeFileSync(process.env.FOLLOW_UP_INDEX ?? "", "- late.txt — written mid-run? LATE-indexed\n");
    await pi.sendUserMessage("follow up", { deliverAs: "followUp" });
    return undefined;
  });
}
