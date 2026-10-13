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
