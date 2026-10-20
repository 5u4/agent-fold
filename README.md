<div align="center">
<h1>agent fold</h1>
<span>A plugin for coding agents to keep the main context a clean thread of decisions, with detail in artifacts.</span>
</div>

## How a run works

1. Every run folds the previous runs' tool calls so the context stays a clean thread of decisions.
2. The agent uses artifacts as a small session memory.
3. In later runs, the agent rehydrates what's important from its artifacts and continues.

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

The plugin loads from the clone, so `git pull` updates both the plugin and the `agent-fold` command. A proxy that is already running keeps the old code. Stop it with `kill` on the `pid` in `~/.local/state/agent-fold/copilot-proxy/proxy.json`, or under `$XDG_STATE_HOME` when that variable is set, and the next launch starts a new one.

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
