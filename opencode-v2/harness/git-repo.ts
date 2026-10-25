import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PLUGIN_DIR } from "./sandbox";

const REPO_ROOT = dirname(PLUGIN_DIR);

function git(cwd: string, args: string[], env?: Record<string, string>): string {
  const result = Bun.spawnSync(["git", "-c", "user.name=agent-fold-test", "-c", "user.email=test@agent-fold.invalid", ...args], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

export function bareMonorepo(root: string, env: Record<string, string>): string {
  const work = join(root, "monorepo");
  const bare = join(root, "monorepo.git");
  mkdirSync(work);
  const files = git(REPO_ROOT, ["ls-files", "--cached", "--others", "--exclude-standard", "--", "opencode-v2"])
    .split("\n")
    .filter(file => file !== "");
  for (const file of files) {
    mkdirSync(dirname(join(work, file)), { recursive: true });
    cpSync(join(REPO_ROOT, file), join(work, file));
  }
  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "agent-fold", private: true, workspaces: ["opencode-v2"] }));
  git(work, ["init", "-q", "-b", "main"], env);
  git(work, ["add", "-A"], env);
  git(work, ["commit", "-q", "-m", "fixture"], env);
  git(root, ["clone", "-q", "--bare", work, bare], env);
  return bare;
}
