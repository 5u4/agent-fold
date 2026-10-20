// extension.ts
import { readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir as homedir3 } from "node:os";
import { join as join3 } from "node:path";
import { CopilotClient, CopilotRequestHandler } from "@github/copilot-sdk";

// context/fold.md
var fold_default = `# Folded runs
A run starts at a user message and ends with your final reply. Once a run ends, later requests keep only that user message and your final reply. Tool calls, tool results, and intermediate text are gone from your context.

When a skill, mode, playbook, or todo list is in force, your final reply names the step it reached and the next step.

## Session index
\`{foldDir}/INDEX.md\` lists where earlier runs found things. Its contents as of this run's start, or \`(empty)\`, appear right after the message that starts this run, so you do not need to read it.

Before your final reply, append a line to \`{foldDir}/INDEX.md\` for each location and result you found that your reply does not spell out, with its locations, the question it answers, and the answer:

\`\`\`md
- src/cache/lru.ts:30-58, src/cache/policy.ts — where is eviction decided? policy.ts sets the size cap that lru.ts enforces
- {foldDir}/upload-timeout.md — why do uploads fail on CI? The 5s timeout trips on cold runners
\`\`\`

If the answer exists only in tool output, write it to a file in \`{foldDir}\` with Result, Evidence, and Reproduction, and point the line at that file.

An INDEX line points only at repo paths or files in \`{foldDir}\`.
`;

// fold.ts
var BOUNDARY_PREFIXES = ["<current_datetime>", "Some of the conversation history has been summarized"];
function startsRun(text) {
  return BOUNDARY_PREFIXES.some((prefix) => text.startsWith(prefix));
}
function foldRun(format, run, kinds) {
  const last = kinds.findLastIndex((kind) => kind === "reply" || kind === "drop");
  if (last < 1 || kinds[last] !== "reply")
    return run;
  return run.flatMap((item, index) => {
    if (index === 0)
      return [item];
    if (kinds[index] === "drop")
      return [];
    const kept = format.keptInFold(item);
    return kept === undefined ? [] : [kept];
  });
}
function foldItems(format, items, kinds) {
  const starts = kinds.flatMap((kind, index) => kind === "boundary" ? [index] : []);
  if (starts.length < 2)
    return items;
  const ends = [...starts.slice(1), items.length];
  const runs = starts.slice(0, -1).flatMap((start, k) => foldRun(format, items.slice(start, ends[k]), kinds.slice(start, ends[k])));
  return [...items.slice(0, starts[0]), ...runs, ...items.slice(starts[starts.length - 1])];
}
function rewriteBody(format, body, { rules, index }) {
  const items = format.items(body);
  if (!items)
    return;
  const kinds = items.map((item) => format.classify(item));
  const lastBoundary = kinds.lastIndexOf("boundary");
  if (lastBoundary === -1)
    return;
  const folded = foldItems(format, items, kinds);
  const at = folded.length - (items.length - lastBoundary) + 1;
  const indexItem = format.indexItem(index(format.runKey(items[lastBoundary])));
  return format.withRules(format.withItems(body, [...folded.slice(0, at), indexItem, ...folded.slice(at)]), rules);
}

// fold-dir.ts
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
var AGENT = "copilot";
function real(path) {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}
function inside(rel) {
  return rel === "" || !rel.startsWith("..") && !isAbsolute(rel);
}
function projectSlug(projectRoot, home = homedir(), tmp = tmpdir()) {
  const root = real(projectRoot);
  const fromTmp = relative(real(tmp), root);
  if (inside(fromTmp))
    return fromTmp === "" ? "-tmp" : `-tmp-${fromTmp.replace(/[/\\:]/g, "-")}`;
  const fromHome = relative(real(home), root);
  if (inside(fromHome))
    return `-${fromHome.replace(/[/\\:]/g, "-")}`;
  return `--${root.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}
function foldDir({ foldHome, projectRoot, startTime, sessionId }) {
  const startedAt = new Date(startTime).toISOString().replace(/\D/g, "").slice(0, 14);
  return join(foldHome, projectSlug(projectRoot), AGENT, `${startedAt}-${sessionId}`);
}
function withFoldDir(rules, dir) {
  return rules.replaceAll("{foldDir}", () => dir);
}
function gitPath(cwd, flag) {
  const { promise, resolve } = Promise.withResolvers();
  execFile("git", ["rev-parse", "--path-format=absolute", flag], { cwd }, (error, stdout) => resolve(error ? undefined : stdout.trim()));
  return promise;
}
async function findProjectRoot(cwd) {
  const commonDir = await gitPath(cwd, "--git-common-dir");
  if (!commonDir)
    return cwd;
  if (basename(commonDir) === ".git")
    return dirname(commonDir);
  return await gitPath(cwd, "--show-toplevel") ?? cwd;
}

// formats.ts
var RESPONSES_DROP = {
  reasoning: true,
  function_call: true,
  function_call_output: true,
  custom_tool_call: true,
  custom_tool_call_output: true
};
var STRIPPED_IN_FOLD = { thinking: true, redacted_thinking: true, tool_result: true };
function parts(content) {
  return typeof content === "string" ? [{ type: "text", text: content }] : content ?? [];
}
function texts(content) {
  return parts(content).flatMap((part) => typeof part.text === "string" ? [part.text] : []);
}
function isBoundary(content) {
  return texts(content).some(startsRun);
}
function hasText(content) {
  return texts(content).some((text) => text.trim() !== "");
}
function arrayAt(body, key) {
  const value = body[key];
  return Array.isArray(value) ? value : undefined;
}
var responses = {
  items: (body) => arrayAt(body, "input"),
  withItems: (body, input) => ({ ...body, input }),
  classify(item) {
    if (item.type !== undefined && item.type !== "message")
      return RESPONSES_DROP[item.type] === true ? "drop" : "keep";
    if (item.role === "user")
      return isBoundary(item.content) ? "boundary" : "steering";
    if (item.role === "assistant")
      return hasText(item.content) ? "reply" : "drop";
    return "keep";
  },
  keptInFold: (item) => item,
  withRules(body, rules) {
    if (typeof body.instructions === "string")
      return { ...body, instructions: `${body.instructions}

${rules}` };
    const input = arrayAt(body, "input") ?? [];
    const [first, ...rest] = input;
    if (first?.role !== "system")
      return { ...body, instructions: rules };
    return { ...body, input: [{ ...first, content: [...parts(first.content), { type: "input_text", text: rules }] }, ...rest] };
  },
  indexItem: (text) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] }),
  runKey: (item) => texts(item.content).join(`
`)
};
var messages = {
  items: (body) => arrayAt(body, "messages"),
  withItems: (body, messages) => ({ ...body, messages }),
  classify(message) {
    const blocks = parts(message.content);
    if (message.role === "user") {
      const toolResults = blocks.filter((block) => block.type === "tool_result").length;
      if (toolResults === 0)
        return isBoundary(message.content) ? "boundary" : "steering";
      return toolResults === blocks.length ? "drop" : "steering";
    }
    if (message.role === "assistant") {
      return blocks.some((block) => block.type === "tool_use") || !hasText(message.content) ? "drop" : "reply";
    }
    return "keep";
  },
  keptInFold(message) {
    if (typeof message.content === "string")
      return message;
    const content = message.content.filter((block) => STRIPPED_IN_FOLD[block.type] !== true);
    return content.length === 0 ? undefined : { ...message, content };
  },
  withRules(body, rules) {
    const system = body.system;
    if (typeof system === "string")
      return { ...body, system: `${system}

${rules}` };
    return { ...body, system: [...Array.isArray(system) ? system : [], { type: "text", text: rules }] };
  },
  indexItem: (text) => ({ role: "user", content: [{ type: "text", text }] }),
  runKey: (message) => texts(message.content).join(`
`)
};
var formats = { "/responses": responses, "/v1/messages": messages };

// launch.ts
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var RESUME_FLAGS = { "-r": true, "--resume": true, "--continue": true };
function hasResumeFlag(parentArgs) {
  return parentArgs.split(/\s+/).some((token) => Object.hasOwn(RESUME_FLAGS, token) || token.startsWith("--resume="));
}
function isThrowawayLaunch(sessionId) {
  try {
    if (!hasResumeFlag(execFileSync("ps", ["-o", "args=", "-p", String(process.ppid)], { encoding: "utf8" })))
      return false;
    const sessionState = join2(process.env.COPILOT_HOME || join2(homedir2(), ".copilot"), "session-state");
    if (existsSync(join2(sessionState, sessionId, "events.jsonl")))
      return false;
    return readdirSync(sessionState).some((id) => id !== sessionId && existsSync(join2(sessionState, id, "events.jsonl")));
  } catch {
    return false;
  }
}

// session-index.ts
var INDEX_MAX_LINES = 300;
var INDEX_MAX_BYTES = 153600;
function capIndex(text) {
  const lines = text.split(`
`);
  if (lines.at(-1) === "")
    lines.pop();
  if (lines.length <= INDEX_MAX_LINES && Buffer.byteLength(text) <= INDEX_MAX_BYTES)
    return text;
  let kept = 0;
  let bytes = 0;
  while (kept < INDEX_MAX_LINES) {
    const next = bytes + Buffer.byteLength(lines[kept]) + 1;
    if (next > INDEX_MAX_BYTES)
      break;
    bytes = next;
    kept++;
  }
  return `${lines.slice(0, kept).map((line) => `${line}
`).join("")}[INDEX.md continues at line ${kept + 1}. Read it from that line for the rest.]`;
}
function indexMessage(dir, text) {
  return `Session index \`${dir}/INDEX.md\` at the start of this run:

${text.trim() === "" ? "(empty)" : capIndex(text)}

Before your final reply, append each location and result your reply does not spell out, as the Session index rules say.`;
}

// extension.ts
var SETUP_WAIT_MS = 5000;
var foldHome = process.env.AGENT_FOLD_HOME || join3(homedir3(), ".agent-fold");
function readIndex(dir) {
  try {
    return readFileSync(join3(dir, "INDEX.md"), "utf8");
  } catch {
    return "";
  }
}
async function injectionFor(session, sessionId) {
  const { startTime, workingDirectory } = await session.rpc.metadata.snapshot();
  const dir = foldDir({ foldHome, projectRoot: await findProjectRoot(workingDirectory), startTime, sessionId });
  await mkdir(dir, { recursive: true });
  let run;
  return {
    rules: withFoldDir(fold_default, dir),
    index: (key) => {
      if (run?.key !== key)
        run = { key, text: indexMessage(dir, readIndex(dir)) };
      return run.text;
    }
  };
}
function settledWithin(promise, ms) {
  const { promise: timeout, resolve } = Promise.withResolvers();
  const timer = setTimeout(resolve, ms);
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

class FoldHandler extends CopilotRequestHandler {
  sessions = new Map;
  async sendRequest(request, ctx) {
    let forwarded = request;
    try {
      forwarded = await this.folded(request, ctx) ?? request;
    } catch {}
    return super.sendRequest(forwarded, ctx);
  }
  async folded(request, ctx) {
    const format = formats[new URL(ctx.url).pathname];
    if (format === undefined || ctx.interactionType !== "conversation-agent")
      return;
    if ((request.headers.get("content-encoding") ?? "identity") !== "identity")
      return;
    const setup = ctx.sessionId === undefined ? undefined : this.sessions.get(ctx.sessionId);
    if (setup === undefined)
      return;
    const injection = await settledWithin(setup, SETUP_WAIT_MS);
    if (injection === undefined)
      return;
    const body = rewriteBody(format, await request.clone().json(), injection);
    if (body === undefined)
      return;
    const headers = new Headers(request.headers);
    headers.delete("content-length");
    return new Request(request.url, { method: request.method, headers, body: JSON.stringify(body), signal: request.signal });
  }
}
var launchSessionId = process.env.SESSION_ID;
if (!launchSessionId || isThrowawayLaunch(launchSessionId))
  process.exit(0);
var handler = new FoldHandler;
var client = new CopilotClient({ _internalConnection: { kind: "parent-process" }, requestHandler: handler });
try {
  await mkdir(foldHome, { recursive: true });
  await client.start();
} catch (error) {
  console.error(`agent-fold: this extension process does not fold: ${error instanceof Error ? error.message : error}`);
  process.exit(0);
}
function keepFoldHomeGranted(session, sessionId) {
  const { paths } = session.rpc.permissions;
  const grant = () => paths.isPathWithinAllowedDirectories({ path: foldHome }).then(({ allowed }) => allowed || paths.add({ path: foldHome })).catch((error) => console.error(`agent-fold: could not grant ${foldHome} to session ${sessionId}: ${error}`));
  session.on("session.custom_agents_updated", grant);
  session.on("session.skills_loaded", grant);
}
function foldSession(sessionId) {
  if (handler.sessions.has(sessionId))
    return;
  handler.sessions.set(sessionId, client.resumeSessionForExtension(sessionId, { additionalDirectories: [foldHome], suppressResumeEvent: true }, {}, undefined).then((session) => {
    keepFoldHomeGranted(session, sessionId);
    return injectionFor(session, sessionId);
  }).catch((error) => {
    console.error(`agent-fold: not folding session ${sessionId}, requests pass through: ${error}`);
    return;
  }));
}
var connection = client.connection;
if (connection === null) {
  console.error("agent-fold: Copilot client has no connection after start, requests pass through");
} else {
  const send = connection.sendRequest.bind(connection);
  connection.sendRequest = (method, params, ...rest) => send(method, method === "session.resume" ? { ...params, requestPermission: false } : params, ...rest);
  foldSession(launchSessionId);
  client.onLifecycle("session.foreground", (event) => foldSession(event.sessionId));
}
