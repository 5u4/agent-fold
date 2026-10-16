import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const AGENT = "copilot";

function real(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function inside(rel: string): boolean {
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function projectSlug(projectRoot: string, home = homedir(), tmp = tmpdir()): string {
  const root = real(projectRoot);
  const fromTmp = relative(real(tmp), root);
  if (inside(fromTmp)) return fromTmp === "" ? "-tmp" : `-tmp-${fromTmp.replace(/[/\\:]/g, "-")}`;
  const fromHome = relative(real(home), root);
  if (inside(fromHome)) return `-${fromHome.replace(/[/\\:]/g, "-")}`;
  return `--${root.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export type FoldDirInput = { foldHome: string; projectRoot: string; startTime: string; sessionId: string };

export function foldDir({ foldHome, projectRoot, startTime, sessionId }: FoldDirInput): string {
  const startedAt = new Date(startTime).toISOString().replace(/\D/g, "").slice(0, 14);
  return join(foldHome, projectSlug(projectRoot), AGENT, `${startedAt}-${sessionId}`);
}

export function withFoldDir(rules: string, dir: string): string {
  return rules.replaceAll("{foldDir}", () => dir);
}

function gitPath(cwd: string, flag: string): Promise<string | undefined> {
  const { promise, resolve } = Promise.withResolvers<string | undefined>();
  execFile("git", ["rev-parse", "--path-format=absolute", flag], { cwd }, (error, stdout) => resolve(error ? undefined : stdout.trim()));
  return promise;
}

export async function findProjectRoot(cwd: string): Promise<string> {
  const commonDir = await gitPath(cwd, "--git-common-dir");
  if (!commonDir) return cwd;
  if (basename(commonDir) === ".git") return dirname(commonDir);
  return (await gitPath(cwd, "--show-toplevel")) ?? cwd;
}
