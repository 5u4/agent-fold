import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { findProjectRoot, foldDir, projectSlug, withFoldDir } from "./fold-dir";

function git(cwd: string, ...args: string[]) {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdio: "pipe" });
}

test("the fold dir joins the fold home, project slug, and the session's UTC start and id", () => {
  expect(
    foldDir({
      foldHome: "/fold-home",
      projectRoot: join(homedir(), "Workspaces", "explain-this"),
      session: { id: "01a1716a-4834-708a-bf0e-760c5d6c1a70", timestamp: "2026-10-14T23:27:38.834Z" },
    }),
  ).toBe("/fold-home/-Workspaces-explain-this/pi/20261014232738-01a1716a-4834-708a-bf0e-760c5d6c1a70");
});

test("a project outside home and the temp dir gets its absolute path as the slug", () => {
  expect(projectSlug("/opt/agent-fold-nowhere/repo")).toBe("--opt-agent-fold-nowhere-repo--");
});

test("worktrees of one repo share the main checkout's slug, and a dir outside git uses its own", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fold-dir-")));
  try {
    const main = join(root, "main");
    const plain = join(root, "plain");
    mkdirSync(join(main, "src"), { recursive: true });
    mkdirSync(plain);
    git(main, "init", "-q");
    git(main, "commit", "-q", "--allow-empty", "-m", "init");
    git(main, "worktree", "add", "-q", join(root, "feature"));
    for (const cwd of [main, join(main, "src"), join(root, "feature")]) {
      expect(projectSlug(await findProjectRoot(cwd))).toBe(`-tmp-${basename(root)}-main`);
    }
    expect(projectSlug(await findProjectRoot(plain))).toBe(`-tmp-${basename(root)}-plain`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a checkout whose git dir lives elsewhere uses its own top level", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "fold-dir-")));
  try {
    const lib = join(root, "lib");
    const sep = join(root, "sep");
    mkdirSync(lib);
    git(lib, "init", "-q");
    git(lib, "commit", "-q", "--allow-empty", "-m", "init");
    git(root, "init", "-q", "--separate-git-dir", join(root, "sepgit"), sep);
    git(sep, "commit", "-q", "--allow-empty", "-m", "init");
    git(sep, "-c", "protocol.file.allow=always", "submodule", "add", "-q", lib, "vendored");
    mkdirSync(join(sep, "src"));
    for (const cwd of [sep, join(sep, "src")]) expect(await findProjectRoot(cwd)).toBe(sep);
    expect(await findProjectRoot(join(sep, "vendored"))).toBe(join(sep, "vendored"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the fold dir goes into the rules verbatim, even with replacement patterns in it", () => {
  expect(withFoldDir("read {foldDir}/INDEX.md, write {foldDir}/x.md", "/home/$&/$1-fold")).toBe(
    "read /home/$&/$1-fold/INDEX.md, write /home/$&/$1-fold/x.md",
  );
});
