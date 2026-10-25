import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function breakFold(pi: ExtensionAPI) {
  pi.on("context", event => {
    const toolUse = event.messages.find(message => message.role === "assistant" && message.stopReason === "toolUse");
    if (toolUse?.role !== "assistant") return undefined;
    const content = toolUse.content;
    let reads = 0;
    Object.defineProperty(toolUse, "content", {
      configurable: true,
      enumerable: true,
      get() {
        if (reads++ === 0) throw new Error("first read of the tool call fails");
        return content;
      },
    });
    return { messages: event.messages };
  });
}
