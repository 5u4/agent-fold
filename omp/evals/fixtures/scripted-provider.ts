import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AssistantMessage, createAssistantMessageEventStream } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { FOLD_DIR, type Reply, type ScriptedRequest } from "../harness/types";

const zeroCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function countLines(file: string): number {
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(line => line !== "").length;
}

function foldDirIn(systemPrompt: string[], foldHome: string | undefined): string | undefined {
  if (!foldHome) return undefined;
  const text = systemPrompt.join("\n");
  const start = text.indexOf(`${foldHome}/`);
  if (start === -1) return undefined;
  const segments = text.slice(start + foldHome.length + 1).match(/^([^/\s`]+)\/([^/\s`]+)\/([^/\s`]+)/);
  return segments ? join(foldHome, segments[1], segments[2], segments[3]) : undefined;
}

export default function scriptedProvider(pi: ExtensionAPI) {
  const requestsFile = requireEnv("FOLD_EVAL_REQUESTS");
  const script: Reply[] = JSON.parse(readFileSync(requireEnv("FOLD_EVAL_SCRIPT"), "utf8"));
  let nextReply = 0;

  pi.registerProvider("scripted", {
    baseUrl: "http://127.0.0.1:1",
    apiKey: "scripted",
    api: "scripted",
    models: [
      {
        id: "scripted",
        name: "scripted",
        reasoning: false,
        input: ["text"],
        cost: zeroCost,
        contextWindow: 100_000,
        maxTokens: 1_000,
      },
    ],
    streamSimple(model, context) {
      const request = countLines(requestsFile);
      const recorded: ScriptedRequest = { systemPrompt: context.systemPrompt ?? [], messages: context.messages };
      appendFileSync(requestsFile, `${JSON.stringify(recorded)}\n`);
      const index = nextReply++;
      const scripted = script[index];
      if (!scripted) throw new Error(`script has no reply for request ${index} of this turn`);
      const foldDir = foldDirIn(recorded.systemPrompt, process.env.AGENT_FOLD_HOME);
      const reply: Reply = JSON.parse(JSON.stringify(scripted).replaceAll(`${FOLD_DIR}/`, foldDir ? `${foldDir}/` : "local://"));
      const stopReason = "text" in reply ? "stop" : "toolUse";
      const message: AssistantMessage = {
        role: "assistant",
        content: "text" in reply ? [{ type: "text", text: reply.text }] : [{ type: "toolCall", id: `call-${request}`, ...reply.toolCall }],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          ...zeroCost,
          input: reply.inputTokens ?? 1,
          output: 1,
          totalTokens: (reply.inputTokens ?? 1) + 1,
          cost: { ...zeroCost, total: 0 },
        },
        stopReason,
        timestamp: Date.now(),
      };
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        stream.push({ type: "start", partial: { ...message, content: [] } });
        message.content.forEach((block, contentIndex) => {
          if (block.type === "toolCall") {
            stream.push({ type: "toolcall_start", contentIndex, partial: message });
            stream.push({ type: "toolcall_end", contentIndex, toolCall: block, partial: message });
          } else if (block.type === "text") {
            stream.push({ type: "text_start", contentIndex, partial: message });
            stream.push({ type: "text_end", contentIndex, content: block.text, partial: message });
          }
        });
        stream.push({ type: "done", reason: stopReason, message });
      });
      return stream;
    },
  });
}
