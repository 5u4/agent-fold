import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { findProjectRoot, foldDir, projectSlug, withFoldDir } from "./fold-dir";

function git(cwd: string, ...args: string[]) {
  const proc = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stderr: "pipe" });
  if (proc.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${proc.stderr.toString()}`);
}

test("the fold dir joins the fold home, project slug, and the root entry's UTC start and id", () => {
  expect(
    foldDir({
      foldHome: "/fold-home",
      projectRoot: join(homedir(), "Workspaces", "explain-this"),
      rootEntry: { id: "a96b385f", timestamp: "2026-10-14T23:27:38.834Z" },
    }),
  ).toBe("/fold-home/-Workspaces-explain-this/20261014232738-a96b385f");
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
    const mainSlug = `-tmp-${basename(root)}-main`;
    for (const cwd of [main, join(main, "src"), join(root, "feature")]) {
      expect(projectSlug(await findProjectRoot(cwd))).toBe(mainSlug);
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
    mkdirSync(join(sep, "vendored", "src"));
    for (const cwd of [sep, join(sep, "src")]) expect(await findProjectRoot(cwd)).toBe(sep);
    for (const cwd of [join(sep, "vendored"), join(sep, "vendored", "src")]) {
      expect(await findProjectRoot(cwd)).toBe(join(sep, "vendored"));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the fold dir goes into the rules verbatim, even with replacement patterns in it", () => {
  expect(withFoldDir("read {foldDir}/INDEX.md, write {foldDir}/x.md", "/home/$&/$1-fold")).toBe(
    "read /home/$&/$1-fold/INDEX.md, write /home/$&/$1-fold/x.md",
  );
});
