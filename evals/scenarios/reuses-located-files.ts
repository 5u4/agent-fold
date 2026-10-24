import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Action, Scenario, Turn } from "../contract";
import { mentions, resultText } from "../transcript";

const LIMITS = "services/gateway/src/settings/limits.ts";
const TOKEN = "packages/identity/src/policy/token.ts";
const TOKEN_SOURCE = `export const ACCESS_TOKEN_TTL_MINUTES = 45;
export const REFRESH_TOKEN_TTL_DAYS = 30;
export const TOKEN_ISSUER = "https://id.northwind.dev";
export const SIGNING_ALGORITHM = "ES256";
`;

const PROJECT: Record<string, string> = {
  "package.json": `${JSON.stringify({ name: "northwind", private: true, workspaces: ["services/*", "packages/*"] }, null, 2)}\n`,
  "tsconfig.json": `${JSON.stringify({ compilerOptions: { strict: true, module: "esnext", target: "es2022" } }, null, 2)}\n`,
  "README.md": `# northwind

Gateway in front of the order and identity services.

- \`services/gateway\`: HTTP edge, sessions, rate limiting.
- \`services/orders\`: order intake.
- \`packages/identity\`: token issuing and password policy.
- \`packages/shared\`: small helpers shared by services.
`,
  "docs/architecture.md": `# Architecture

The gateway keeps a server-side session per browser. As of the 2022 design review, sessions expired after
30 minutes of inactivity and access tokens lived for 15 minutes. Refresh tokens rotate on every use.
`,
  "legacy/auth/session.js": `const SESSION_TIMEOUT = 60; // unused since v2

module.exports = { SESSION_TIMEOUT };
`,
  "services/gateway/package.json": `${JSON.stringify({ name: "@northwind/gateway", version: "2.4.0" }, null, 2)}\n`,
  "services/gateway/src/index.ts": `import { createServer } from "node:http";
import { touchSession } from "./middleware/session";
import { health } from "./routes/health";

createServer((req, res) => {
	if (req.url === "/health") return health(res);
	touchSession(req);
	res.end("ok");
}).listen(8080);
`,
  [LIMITS]: `export const MAX_REQUEST_BODY_KB = 512;
export const RATE_LIMIT_PER_MINUTE = 600;
export const SESSION_IDLE_MINUTES = 20;
export const UPSTREAM_TIMEOUT_SECONDS = 15;
`,
  "services/gateway/src/middleware/session.ts": `import type { IncomingMessage } from "node:http";
import { minutes } from "../../../../packages/shared/src/time";
import { SESSION_IDLE_MINUTES } from "../settings/limits";

const lastSeen = new Map<string, number>();

export function touchSession(req: IncomingMessage): boolean {
	const id = req.headers.cookie ?? "";
	const now = Date.now();
	const fresh = now - (lastSeen.get(id) ?? now) < minutes(SESSION_IDLE_MINUTES);
	lastSeen.set(id, now);
	return fresh;
}
`,
  "services/gateway/src/routes/health.ts": `import type { ServerResponse } from "node:http";

export function health(res: ServerResponse): void {
	res.end(JSON.stringify({ status: "up" }));
}
`,
  "services/orders/src/config.ts": `export const ORDER_HOLD_MINUTES = 45;
export const MAX_LINE_ITEMS = 200;
`,
  "packages/identity/package.json": `${JSON.stringify({ name: "@northwind/identity", version: "1.9.0" }, null, 2)}\n`,
  "packages/identity/src/index.ts": `export * from "./policy/password";
export * from "./policy/token";
`,
  [TOKEN]: TOKEN_SOURCE,
  "packages/identity/src/policy/password.ts": `export const MIN_PASSWORD_LENGTH = 12;
export const LOCKOUT_MINUTES = 20;
export const MAX_FAILED_ATTEMPTS = 5;
`,
  "packages/shared/src/time.ts": `export const minutes = (count: number): number => count * 60_000;
`,
};

type FinalFiles = { limits: string; token: string };

const SEARCH_COMMAND = /\b(rg|grep|find|fd|ls|tree)\b/;

function isSearch(action: Action): boolean {
  return action.kind === "search" || (action.kind === "shell" && SEARCH_COMMAND.test(action.command));
}

function callsBeforeReaching(turn: Turn, path: string): Action[] {
  const reached = turn.actions.findIndex(action => mentions(action, path));
  return turn.actions.slice(0, reached === -1 ? turn.actions.length : reached);
}

export const reusesLocatedFiles: Scenario<FinalFiles> = {
  title: "reaches files an earlier run located without searching again",
  async setup(workdir) {
    for (const [path, content] of Object.entries(PROJECT)) {
      mkdirSync(dirname(join(workdir, path)), { recursive: true });
      writeFileSync(join(workdir, path), content);
    }
    return { limits: "", token: "" };
  },
  turns: [
    "Is the gateway's idle session timeout shorter than the access token lifetime? Answer only yes or no.",
    "Make the gateway's idle session timeout equal to the access token lifetime.",
  ],
  async inspect(workdir) {
    return { limits: readFileSync(join(workdir, LIMITS), "utf8"), token: readFileSync(join(workdir, TOKEN), "utf8") };
  },
  grade(run, files) {
    const [first, second] = run.turns;
    const seen = resultText(first);
    const unread = [
      ["SESSION_IDLE_MINUTES = 20", LIMITS],
      ["ACCESS_TOKEN_TTL_MINUTES = 45", TOKEN],
    ].filter(([line]) => !seen.includes(`export const ${line}`));
    if (unread.length) return { status: "invalid", evidence: `turn 1 never read ${unread.map(([, path]) => path).join(", ")}` };
    const revealed = [LIMITS, TOKEN].filter(path => first.reply.includes(path));
    if (revealed.length) return { status: "invalid", evidence: `turn-1 reply named ${revealed.join(", ")}` };
    const idle = files.limits.match(/\bSESSION_IDLE_MINUTES\s*=\s*([^;\n]+)/)?.[1].trim();
    if (idle !== "45" && idle !== "ACCESS_TOKEN_TTL_MINUTES")
      return { status: "fail", evidence: `SESSION_IDLE_MINUTES is ${JSON.stringify(idle)}, not 45` };
    if (files.token !== TOKEN_SOURCE) return { status: "fail", evidence: `${TOKEN} changed: ${JSON.stringify(files.token)}` };
    const before = callsBeforeReaching(second, LIMITS);
    return before.some(isSearch)
      ? {
          status: "fail",
          evidence: `turn 2 searched before reaching ${LIMITS}: ${before
            .map(action => `${action.name}(${String(action.args.path ?? action.args.pattern ?? action.args.command ?? "")})`)
            .join(" > ")
            .slice(0, 400)}`,
        }
      : { status: "pass", evidence: `turn 2 went to ${LIMITS} without searching and set the idle timeout to 45` };
  },
  metrics(run) {
    const [first, second] = run.turns;
    return {
      "turn-2 searches before reaching limits.ts": callsBeforeReaching(second, LIMITS).filter(isSearch).length,
      "turn-1 fold-dir tool calls": first.actions.filter(action => mentions(action, run.foldHome)).length,
      "turn-2 tool calls": second.actions.length,
    };
  },
};
