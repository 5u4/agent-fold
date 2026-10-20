import { join } from "node:path";

const PACKAGE_DIR = import.meta.dir;

export const EXTENSION_PATH = join(PACKAGE_DIR, "com.github.copilot/extensions/agent-fold/extension.mjs");

export async function buildExtension(): Promise<string> {
  // Bun labels each bundled module with its path relative to the cwd, so the build runs from the package dir.
  const proc = Bun.spawn(["bun", "build", "extension.ts", "--target=node", "--format=esm", "--external=@github/copilot-sdk"], {
    cwd: PACKAGE_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) throw new Error(`extension build failed: ${stderr}`);
  return stdout;
}

if (import.meta.main) await Bun.write(EXTENSION_PATH, await buildExtension());
