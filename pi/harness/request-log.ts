import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function requestLog(pi: ExtensionAPI) {
  const file = process.env.FOLD_EVAL_REQUESTS;
  if (!file) throw new Error("FOLD_EVAL_REQUESTS is not set");
  pi.on("before_provider_request", event => {
    appendFileSync(file, `${JSON.stringify(event.payload)}\n`);
    return undefined;
  });
}
