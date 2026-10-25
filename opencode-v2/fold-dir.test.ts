import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { foldDir, projectSlug, withFoldDir } from "./fold-dir";

test("the fold dir joins the fold home, project slug, and the session's UTC creation time and id", () => {
  expect(
    foldDir({
      foldHome: "/fold-home",
      projectRoot: join(homedir(), "Workspaces", "explain-this"),
      session: { id: "ses_e8d96f11effel3v7OeWAwoz4Np", created: Date.parse("2026-10-14T23:27:38.834Z") },
    }),
  ).toBe("/fold-home/-Workspaces-explain-this/opencode-v2/20261014232738-ses_e8d96f11effel3v7OeWAwoz4Np");
});

test("a project outside home and the temp dir gets its absolute path as the slug", () => {
  expect(projectSlug("/opt/agent-fold-nowhere/repo")).toBe("--opt-agent-fold-nowhere-repo--");
});

test("every {foldDir} placeholder is filled, and $ patterns in the path stay literal", () => {
  expect(withFoldDir("{foldDir}/INDEX.md and {foldDir}/x.md", "/d/$&")).toBe("/d/$&/INDEX.md and /d/$&/x.md");
});
