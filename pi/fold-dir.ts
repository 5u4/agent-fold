import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export type SessionKey = { id: string; timestamp: string };

export type FoldDirInput = { foldHome: string; projectRoot: string; session: SessionKey };

const AGENT = "pi";

function canonical(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function within(rel: string): boolean {
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function encodeRelative(prefix: string, rel: string): string {
  const encoded = rel.replace(/[/\\:]/g, "-");
  if (!encoded) return prefix;
  return prefix.endsWith("-") ? `${prefix}${encoded}` : `${prefix}-${encoded}`;
}

export function projectSlug(projectRoot: string): string {
  const root = canonical(projectRoot);
  const tempRelative = relative(canonical(tmpdir()), root);
  if (within(tempRelative)) return encodeRelative("-tmp", tempRelative);
  const homeRelative = relative(canonical(homedir()), root);
  if (within(homeRelative)) return encodeRelative("-", homeRelative);
  return `--${root.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function foldDir({ foldHome, projectRoot, session }: FoldDirInput): string {
  const startedAt = new Date(session.timestamp).toISOString().replace(/\D/g, "").slice(0, 14);
  return join(foldHome, projectSlug(projectRoot), AGENT, `${startedAt}-${session.id}`);
}

export function withFoldDir(rules: string, dir: string): string {
  return rules.replaceAll("{foldDir}", () => dir);
}

async function gitPath(cwd: string, flag: string): Promise<string | undefined> {
  const result = await promisify(execFile)("git", ["rev-parse", "--path-format=absolute", flag], { cwd }).catch(() => undefined);
  return result?.stdout.trim();
}

export async function findProjectRoot(cwd: string): Promise<string> {
  const commonDir = await gitPath(cwd, "--git-common-dir");
  if (!commonDir) return cwd;
  if (basename(commonDir) === ".git") return dirname(commonDir);
  return (await gitPath(cwd, "--show-toplevel")) ?? cwd;
}
