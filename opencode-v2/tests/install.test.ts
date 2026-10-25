import { afterEach, expect, test } from "bun:test";
import { bareMonorepo } from "../harness/git-repo";
import { PASSWORD, type Server, startServer } from "../harness/opencode";
import { createSandbox, type Sandbox } from "../harness/sandbox";

type PluginInfo = { id: string; source: { type: string; target?: string }; features: Record<string, boolean>; state: { status: string } };

let sandbox: Sandbox;
let server: Server | undefined;

afterEach(async () => {
  await server?.stop();
  sandbox.dispose();
});

async function installedPlugins(url: string, directory: string): Promise<PluginInfo[]> {
  const headers = { authorization: `Basic ${btoa(`opencode:${PASSWORD}`)}` };
  for (let attempt = 0; attempt < 150; attempt++) {
    const body = (await (await fetch(`${url}/api/plugin?directory=${encodeURIComponent(directory)}`, { headers })).json()) as {
      data: PluginInfo[];
    };
    const installed = body.data.filter(plugin => plugin.source.type !== "builtin");
    if (installed.length > 0 && installed.every(plugin => plugin.state.status !== "loading")) return installed;
    await Bun.sleep(200);
  }
  throw new Error("the installed plugin never finished loading");
}

test("a git+file install of the opencode-v2 subdirectory loads both the server and the TUI entry", async () => {
  sandbox = createSandbox({ plugin: false });
  const bare = bareMonorepo(sandbox.root, sandbox.env);
  const spec = `git+file://${bare}#main::path:opencode-v2`;
  const add = Bun.spawnSync(["opencode", "plugin", "add", spec], {
    cwd: sandbox.project,
    env: sandbox.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(add.exitCode).toBe(0);

  server = await startServer(sandbox);
  expect(await installedPlugins(server.url, sandbox.project)).toEqual([
    expect.objectContaining({
      id: "agent-fold",
      source: expect.objectContaining({ type: "package", target: spec }),
      features: { server: true, tui: true },
      state: { status: "active" },
    }),
  ]);
}, 120_000);
