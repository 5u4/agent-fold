# AGENTS.md

Run every command here from `copilot/` unless a step says otherwise.

## Overview
agent-fold folds GitHub Copilot through a localhost API proxy. Copilot CLI and the GitHub Copilot app's bundled runtime send every API call to `COPILOT_API_URL` over plain HTTP when it is set in their process environment. `agent-fold copilot` and `agent-fold gh-app` start the proxy if none is running and launch Copilot with `COPILOT_API_URL` pointing at it. The proxy rewrites the main agent's model requests and forwards every other request with its body unchanged, as Routing below details. The extension only grants the fold home, which holds every fold dir, and warns when a session bypasses the proxy. Copilot CLI 1.0.101 prefers the `copilotUrl` key in `~/.copilot/settings.json` over `COPILOT_API_URL`, so a user who sets that key bypasses the proxy in the CLI. The app ignores `copilotUrl`.

The proxy replaced an extension that owned `llmInference.setProvider`. In the GitHub Copilot app the runtime refused `setProvider` with "Cannot set LLM inference provider while sessions are active", so nothing folded there.

## Extension
`extension.ts` is a GitHub Copilot CLI extension. `bun run build` bundles it with `@github/copilot-sdk` left external into `com.github.copilot/extensions/agent-fold/extension.mjs`, which is committed because the CLI loads it from the plugin directory without a build step. `build.test.ts` fails when the committed file differs from a fresh build, so run `bun run build` after every source change. Extensions are an experimental Copilot CLI feature, and every extension smoke run here used `--experimental`. The proxy folds without the extension.

Without `SESSION_ID` the extension exits with code 0. Otherwise it creates the fold home and calls `joinSession({ additionalDirectories: [foldHome] })` from `@github/copilot-sdk/extension`, which grants an existing dir without a dialog. A dir that does not exist is not granted. Without the grant, a `-p --allow-all-tools` run that writes `INDEX.md` gets "Permission denied because no interactive user response was available".

In Copilot CLI 1.0.100, when the TUI switched back to a session, it replaced that session's additional directories within about 30 ms after `session.foreground`, so `/resume` dropped the fold home grant. The extension checks the grant on every `session.custom_agents_updated` and `session.skills_loaded` event, which the runtime emitted right after that replacement, and adds the fold home back with `permissions.paths.add` when it is missing. A re-grant on `session.foreground` landed before the replacement and was lost.

On the first `session.idle` the extension reads `proxy.json` and the secret and asks the proxy whether it has seen the session id. Unless the proxy proves its identity and has seen the session, it calls `session.log` with `level: "warning"` and `ephemeral: true` to say that the session's runs are not folded and how to start Copilot through agent-fold. It checks once per process. The TUI shows the warning under the reply. A `-p` run exits before it shows. Extension processes do not inherit `COPILOT_API_URL`, so the extension cannot read the route from its environment.

## Proxy and CLI
`cli.ts` is the `agent-fold` bin. Install it with `bun link` in `copilot/`. Bun runs the TypeScript from source.

- `agent-fold proxy` serves `startProxy` on a random port of 127.0.0.1, writes `proxy.json`, and on SIGTERM or SIGINT removes `proxy.json` if it still names its own pid.
- `agent-fold copilot [args...]` runs `ensureProxy`, then `launch.copilot` plus the args with `COPILOT_API_URL=http://127.0.0.1:<port>/launch/<new uuid>`. It inherits stdio, ignores SIGINT while the child runs, and exits with the child's code.
- `agent-fold gh-app [args...]` runs `ensureProxy` and `launch.gh-app` the same way, with stdio inherited but SIGINT not ignored. When it starts the command it also starts polling the proxy for up to 15 s for a request under the launch id, because a wrapper may stay in the foreground. If none arrives in time, it says that the app may already be running or that the launch command dropped `COPILOT_API_URL`. A non-zero exit of the command returns that code at once. After a zero exit it waits for the poll and exits with 0 when the request arrived and 1 when it did not.
- Any other subcommand prints the usage and exits with code 2.

`ensureProxy` reuses the proxy that `proxy.json` names when that proxy proves its identity and speaks `PROTOCOL`. Otherwise it spawns `agent-fold proxy` detached, appends its output to `proxy.log`, and polls for up to 5 s for a state that proves identity. It never stops a running proxy, because other sessions may use it. A proxy with an older protocol keeps serving its sessions while a new one takes over `proxy.json`. A running proxy keeps the `AGENT_FOLD_HOME` and `COPILOT_HOME` of the launch that started it.

If the caller's environment already sets `COPILOT_API_URL` to anything but a proxy that proves its identity, the launcher exits with code 2 and points at the `upstream` config key. Both Copilot CLI and the app runtime fail with "Failed to load models" when `COPILOT_API_URL` points at a port with no listener, so the launcher starts the proxy before it launches Copilot.

`paths.ts` holds every location:

- The fold home is `${AGENT_FOLD_HOME || ~/.agent-fold}`.
- The config is `${XDG_CONFIG_HOME || ~/.config}/agent-fold/copilot.json`. agent-fold only reads it.
- The proxy dir is `${XDG_STATE_HOME || ~/.local/state}/agent-fold/copilot-proxy`, mode 0700. It holds `secret` and `proxy.json`, both mode 0600, and `proxy.log`.
- Copilot's session state is `${COPILOT_HOME || ~/.copilot}/session-state`.

The config and the proxy state live outside the fold home because the model writes the fold home without prompts. A model-edited `upstream` or port would send the user's token elsewhere.

`config.ts` parses `{ "upstream"?: "https://...", "launch"?: { "copilot"?: string[], "gh-app"?: string[] } }`. It rejects unknown keys, an `upstream` that is not an `https:` URL, and a launch command that is not a non-empty array of non-empty strings, and names the bad key. A launch command is an argv, never a shell string. `launch.copilot` defaults to `["copilot"]`. `launch.gh-app` defaults to `["open", "-a", "GitHub Copilot"]` on macOS and has no default elsewhere.

`proxy-state.ts` owns the secret and `proxy.json`. `ensureSecret` links a fully written temp file into place, so concurrent first launches agree on one secret. `queryProxy` sends `GET /_agent-fold/status?nonce=<random hex>` and accepts the answer only when its `proof` equals the HMAC-SHA256 of the nonce under the secret. That challenge tells the proxy apart from another process on the same port without sending the secret.

### Routing
`proxy.ts` strips an optional `/launch/<uuid>` prefix and classifies each request once:

| Route | When | Response |
| --- | --- | --- |
| `forbidden` | The `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` | 403 |
| `rejectUpgrade` | The request has an `Upgrade` header | 404 |
| `status` | `GET /_agent-fold/status` | `{ protocol, proof, launchSeen, sessionSeen }` |
| `fold` | `POST` to a path in the `formats` registry, `x-interaction-type` in the folded set, a UUID `x-client-session-id`, and no content encoding | The rewritten body, forwarded |
| `forward` | Everything else | Forwarded unchanged |

The runtime sends `GET /responses` with `Upgrade: websocket` before each run. The 404 makes it fall back to `POST /responses`. `GET /models` keeps the `/launch/<id>` prefix and `POST /mcp/readonly` drops it, so the prefix is optional. The proxy records each launch id and each `x-client-session-id` it sees for the status route.

Forwarding streams the response body, so SSE flows chunk by chunk. It streams the request body too, except on the `fold` route, which reads the whole body to rewrite it. It drops `host`, the hop-by-hop headers, the `proxy-*` headers, and `accept-encoding`, and drops `content-length` when the body changed. The response loses `content-encoding`, `content-length`, and the hop-by-hop headers. The client's abort signal aborts the upstream fetch. The proxy logs one line per request to stderr, with a timestamp, the method, the path without its query or launch prefix, the status, the `x-interaction-type` value, and `folded` or `unfolded`. It logs no other header, no body, and no query.

The upstream base is `upstream` from the config or else `endpoints.api` from `GET https://api.github.com/copilot_internal/user` with the request's `Authorization` header, which is the GitHub OAuth token. The proxy caches the discovery per token hash and drops a failed one. With no upstream it answers 502 with a one-line reason. The upstream URL is the base's origin and path, then the stripped path and the query.

## Folding
Model requests carry `x-interaction-type`. `conversation-user` is the first request of a run, `conversation-agent` follows a tool call, and the proxy folds only these two. `conversation-subagent`, `conversation-background` (classifiers and titles, including `/chat/completions`), and `conversation-compaction` are forwarded byte for byte. A fold request is rewritten only when its body holds at least one run boundary. Any error in the rewrite forwards the original bytes.

Each format classifies its native items as `boundary`, `steering`, `reply`, `drop`, or `keep`. A boundary is a user item with a text part that starts with `<current_datetime>` or with the compaction summary's "Some of the conversation history has been summarized". On `/responses`, an assistant message with `phase: "commentary"` is a `drop`, so the narration between tool calls leaves with the tools. `fold.ts` folds every run except the last when the run's last `reply` or `drop` item is a `reply`. A folded run keeps its boundary, its steering and `keep` items, and its replies. On `/v1/messages`, kept items lose `thinking`, `redacted_thinking`, and `tool_result` blocks, and an item left with no blocks is dropped. Kept items are never converted into another format, so their ids, phases, and unknown fields pass through, and items outside folded runs pass through unchanged.

The proxy appends `context/fold.md` to the system position (`instructions` or a leading system input item on `/responses`, `system` on `/v1/messages`) and inserts the `INDEX.md` snapshot right after the last boundary. The snapshot is read again only when the text of the last boundary changes, so it stays fixed for the whole run. It keeps at most 300 lines and 153600 bytes, like omp.

## Fold dir
The fold dir is `${AGENT_FOLD_HOME || ~/.agent-fold}/<project-slug>/copilot/<UTC start yyyymmddHHMMSS>-<session id>/`. `fold-dir.ts` reproduces omp's slug: the main checkout of the git repo holding the working directory, the checkout's top level when its git common dir is not a `.git` dir, or the working directory outside git. The working directory is `data.context.cwd` of the session's own `session.start` event. The start time and id come from the conversation root, so a fork and a fork of that fork share the original session's dir and `INDEX.md`, like omp, where a fork keeps the same key.

The API carries no fork parent, so `session-root.ts` reads private CLI state. It reads the first line of `$COPILOT_HOME/session-state/<id>/events.jsonl` for every session dir. That line is the `session.start` event. A fork copies the parent's events, so its first event keeps the parent's event `id` and gets its own `data.sessionId` and `data.startTime`. The root is the session with the earliest `data.startTime` among those sharing the session's first event `id`. An ordinary session is its own root. If the original session was deleted, the earliest surviving fork is the root.

The proxy builds a session's fold dir and rules on the session's first fold request and caches them per session id. Copilot CLI 1.0.101 under `-p` writes `events.jsonl` of a new session about when it sends the first model request, so on a session's first fold request the proxy waits up to 2 s for the `session.start` line. If the line is still missing, that request is forwarded unfolded and each later request reads once more without waiting, so a session whose state the proxy cannot find costs at most one 2 s delay.

## Verify
- Run `bun run typecheck` and `bun test`; `bun test` includes the rebuild check. From the repo root, run `biome check copilot`.
- Smoke every behavior change in a scratch git repo with `AGENT_FOLD_HOME` and `XDG_STATE_HOME` set to temp dirs, after `bun link` in `copilot/`. `proxy.log` in the temp state dir shows each request's method, path, status, `x-interaction-type`, and whether it was folded. To see what reaches the model, patch a copy of `proxy.ts` to write each request's body before and after the rewrite; never commit that patch. Kill every proxy you start: `proxy.json` has its pid. Run `bun unlink` at the end.
  1. Run `agent-fold copilot -p "Use a shell command to cat data.txt, then reply with only the word done" --allow-all-tools --model gpt-6.1-sol`, then `agent-fold copilot --continue -p "Without using any tools, what exact token was in data.txt?" --model gpt-6.1-sol`. Every `POST /responses` of the main agent logs `folded`. Background requests log `unfolded`. The fold dir exists. If the model wrote the token into `INDEX.md` in the first run, the token reaches the second request only through the index snapshot and the answer may quote it. Otherwise the answer does not quote it. Repeat with a Claude model such as `claude-haiku-4.5` for `/v1/messages`.
  2. Copy the build to `.github/extensions/agent-fold/extension.mjs` in the scratch repo and set `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS=true`. Under `agent-fold copilot --experimental -p ... --allow-all-tools`, the model appends to `INDEX.md` without a dialog. In the TUI in tmux, plain `copilot --experimental` shows the bypass warning after the first reply, and `agent-fold copilot --experimental` does not. The TUI asks for folder trust at each launch; answer "1. Yes".
  3. In one TUI started with `agent-fold copilot --experimental` in the scratch repo of step 2, run `/new`, `/clear`, `/fork`, and `/resume <earlier id>`, each followed by the check in step 1. `/fork`, and `/fork` again from the fork, reuse the original session's fold dir. After `/resume`, the next request lists the fold home under "Additional directories available for file access".
  4. Smoke the app with `agent-fold gh-app` after quitting the app, with the plugin installed from the clone, in a scratch repo without `.github/extensions`. For a session whose repo holds untrusted project extensions, app 1.1.30 logs `request_extensions=false` and creates the session with `requestExtensions: false`, and then no extension runs, the plugin's included. Drive the app over its local WebSocket at `ws://127.0.0.1:<line 1 of ~/.copilot/run/ws.port>/?token=<line 1 of ~/.copilot/run/ws.token>`: send `{"type":"create_session","cwd":...}`, then `{"type":"set_session_auto_approve","session_id":...,"auto_approve":true}`, then `{"type":"send_message","session_id":...,"prompt":...}` with the prompts of step 1, and `{"type":"archive_session","session_id":...}` at the end. Without auto-approve the app asks to approve the `INDEX.md` write even though the fold home is granted, and the turn waits. The proxy logs the app's main requests as `folded`, and the session's `session.resume` in the runtime log carries the fold home in `additionalDirectories`.
- Test the plugin path with `COPILOT_HOME` and `XDG_STATE_HOME` set to temp dirs, so a fresh proxy reads the temp `COPILOT_HOME`: `copilot plugin marketplace add <repo>`, `copilot plugin install agent-fold@agent-fold`, then `GITHUB_COPILOT_PROMPT_MODE_EXTENSIONS=true agent-fold copilot --experimental -p "<ask to append a line to the session index>" --allow-all-tools` writes `INDEX.md` without "Permission denied". The proxy creates the fold dir with or without the plugin, so the fold dir alone does not show that the plugin loaded.
- Hash `~/.copilot/settings.json`, `config.json`, and `permissions-config.json` before and after the smoke. agent-fold must not change them. The app smoke needs the plugin in the real `~/.copilot`. After `copilot plugin marketplace add`, `install`, `uninstall`, and `marketplace remove`, `settings.json` keeps `extraKnownMarketplaces: {}` and `enabledPlugins: {"agent-fold@agent-fold": false}`, so restore that file after the app smoke.
