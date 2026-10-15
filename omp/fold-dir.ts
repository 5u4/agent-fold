import { basename, dirname, join } from "node:path";
import { sessionDirForCwd } from "@oh-my-pi/pi-coding-agent/session/session-paths";

export type RootEntry = { id: string; timestamp: string };

export type FoldDirInput = { foldHome: string; projectRoot: string; rootEntry: RootEntry };

export function projectSlug(projectRoot: string): string {
  return basename(sessionDirForCwd(projectRoot, "/"));
}

export function foldDir({ foldHome, projectRoot, rootEntry }: FoldDirInput): string {
  const startedAt = new Date(rootEntry.timestamp).toISOString().replace(/\D/g, "").slice(0, 14);
  return join(foldHome, projectSlug(projectRoot), `${startedAt}-${rootEntry.id}`);
}

export async function findProjectRoot(cwd: string): Promise<string> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const commonDir = stdout.trim();
    return exitCode === 0 && basename(commonDir) === ".git" ? dirname(commonDir) : cwd;
  } catch {
    return cwd;
  }
}
