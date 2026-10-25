import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FakeProvider, startFakeProvider } from "./fake-provider";

export const PLUGIN_DIR = join(import.meta.dir, "..");

export type SandboxOptions = { plugin?: boolean; contextLimit?: number };

export type Sandbox = {
  root: string;
  home: string;
  project: string;
  db: string;
  provider: FakeProvider;
  env: Record<string, string>;
  dispose(): void;
};

export function createSandbox({ plugin = true, contextLimit = 100_000 }: SandboxOptions = {}): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "oc2-fold-")));
  const home = join(root, "home");
  const project = join(root, "project");
  for (const dir of ["config", "data", "state", "cache", "npm", "signals", "home", "project"]) mkdirSync(join(root, dir));
  const toolPath = join(project, "note.txt");
  writeFileSync(toolPath, "NOTE-CONTENT\n");
  const provider = startFakeProvider({ toolPath, signalDir: join(root, "signals") });
  writeFileSync(
    join(project, "opencode.json"),
    JSON.stringify({
      providers: {
        fake: {
          package: "@opencode/ai/providers/openai-compatible",
          env: ["FAKE_API_KEY"],
          settings: { baseURL: provider.baseUrl },
          models: { m: { limit: { context: contextLimit, output: 1_000 } } },
        },
      },
      model: "fake/m",
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
      plugins: plugin ? [PLUGIN_DIR] : [],
    }),
  );
  const db = join(root, "opencode.db");
  const env = {
    PATH: process.env.PATH ?? "",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    OPENCODE_DB: db,
    npm_config_cache: join(root, "npm"),
    FAKE_API_KEY: "fake",
  };
  return {
    root,
    home,
    project,
    db,
    provider,
    env,
    dispose() {
      provider.stop();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
