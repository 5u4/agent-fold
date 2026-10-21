<div align="center">
<h1>agent fold</h1>
<span>A plugin for coding agents to keep the main context a clean thread of decisions, with detail in artifacts.</span>
</div>

## How a run works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/how-a-run-works/dark.png">
  <img alt="The same chat shown twice, your messages on the right and the agent's on the left. While the agent works, its five tool calls sit between your question and its reply, and the context meter reads 15%. On your next message, those tool calls are struck through in red with the note that they were automatically dropped from context. Your question, the reply, and your new message stay, and the context meter drops to 4%." src="docs/how-a-run-works/light.png">
</picture>

1. A run starts at your message and ends at the agent's final reply. Before that reply, the agent records what the reply leaves out in `INDEX.md` and notes under `~/.agent-fold`.
2. When the next run starts, the earlier run keeps your messages and its final reply. Its tool calls fold away. The new run gets a snapshot of `INDEX.md`.
3. The agent reads a note back only when it needs the detail.

## Install

### Oh My Pi

```sh
omp plugin marketplace add 5u4/agent-fold
omp plugin install agent-fold@agent-fold
```

Restart omp to load the plugin.

#### Uninstall

```sh
omp plugin uninstall agent-fold@agent-fold
omp plugin marketplace remove agent-fold
```

### GitHub Copilot CLI and app

agent-fold folds Copilot through a local proxy that the `agent-fold` command starts. It needs [Bun](https://bun.sh).

```sh
git clone https://github.com/5u4/agent-fold.git
cd agent-fold/copilot
bun link
copilot plugin marketplace add ..
copilot plugin install agent-fold@agent-fold
```

The plugin loads from the clone, so `git pull` updates both the plugin and the `agent-fold` command. A proxy that is already running keeps the old code. Stop it with `kill` on the `pid` in the highest-numbered `proxy-<n>.json` under `~/.local/state/agent-fold/copilot-proxy/`, or under `$XDG_STATE_HOME/agent-fold/copilot-proxy/` when that variable is set, and the next launch starts a new one on a random port. Every Copilot CLI and app session that used the killed proxy then fails its model requests, so quit those sessions first or relaunch them through `agent-fold` afterwards.

Start Copilot CLI with `agent-fold copilot --experimental`. It takes the same arguments as `copilot`, and `--experimental` loads the plugin, which lets the agent write its notes without a permission prompt. To start the GitHub Copilot app, quit it, then run `agent-fold gh-app`. Outside macOS, set `launch.gh-app` in the config below first. The app still asks you to approve the agent's note writes, like any other file edit, unless the session auto-approves. A session started any other way is not folded, and neither is a CLI session when `copilotUrl` is set in `~/.copilot/settings.json`. With the plugin loaded, the Copilot CLI TUI shows a warning after such a session's first reply.

To launch Copilot through another command or to set the Copilot API endpoint yourself, write `~/.config/agent-fold/copilot.json`, or `$XDG_CONFIG_HOME/agent-fold/copilot.json` when that variable is set:

```json
{
  "launch": { "copilot": ["agency", "copilot"], "gh-app": ["agency", "gh-app"] },
  "upstream": "https://api.enterprise.githubcopilot.com"
}
```

Without `upstream`, agent-fold asks GitHub for your account's Copilot API endpoint.

#### Uninstall

```sh
copilot plugin uninstall agent-fold@agent-fold
copilot plugin marketplace remove agent-fold
cd agent-fold/copilot && bun unlink
```
