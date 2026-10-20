import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig, readConfig } from "./config";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agent-fold-config-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function configFile(text: string): string {
  const path = join(dir, "copilot.json");
  writeFileSync(path, text);
  return path;
}

test("a missing config file gives the defaults", () => {
  const config = readConfig(join(dir, "missing.json"));
  expect(config.upstream).toBeUndefined();
  expect(config.launch.copilot).toEqual(["copilot"]);
});

test("a full config file sets the upstream and both launch commands", () => {
  const config = readConfig(
    configFile(
      JSON.stringify({
        upstream: "https://api.enterprise.githubcopilot.com/base",
        launch: { copilot: ["agency", "copilot"], "gh-app": ["agency", "gh-app"] },
      }),
    ),
  );
  expect(config.upstream?.href).toBe("https://api.enterprise.githubcopilot.com/base");
  expect(config.launch).toEqual({ copilot: ["agency", "copilot"], "gh-app": ["agency", "gh-app"] });
});

test("a config setting one launch command keeps the default for the other", () => {
  expect(parseConfig({ launch: { "gh-app": ["my-app"] } }, "darwin").launch).toEqual({ copilot: ["copilot"], "gh-app": ["my-app"] });
});

test("the GitHub Copilot app has a default launch command only on macOS", () => {
  expect(parseConfig({}, "darwin").launch["gh-app"]).toEqual(["open", "-a", "GitHub Copilot"]);
  expect(parseConfig({}, "linux").launch["gh-app"]).toBeUndefined();
  expect(parseConfig({}, "win32").launch["gh-app"]).toBeUndefined();
});

test.each([
  [[], "the config must be a JSON object"],
  [{ upstrem: "https://x" }, "upstrem is not a known key"],
  [{ upstream: "http://api.example.com" }, "upstream must be an https: URL"],
  [{ upstream: "not a url" }, "upstream must be an https: URL"],
  [{ upstream: 443 }, "upstream must be an https: URL"],
  [{ launch: ["copilot"] }, "launch must be an object"],
  [{ launch: { cli: ["copilot"] } }, "launch.cli is not a known key"],
  [{ launch: { copilot: "agency copilot" } }, "launch.copilot must be a non-empty array of non-empty strings"],
  [{ launch: { copilot: [] } }, "launch.copilot must be a non-empty array of non-empty strings"],
  [{ launch: { "gh-app": ["open", 1] } }, "launch.gh-app must be a non-empty array of non-empty strings"],
])("config %j is rejected naming the bad key", (json, message) => {
  expect(() => parseConfig(json, "darwin")).toThrow(message);
});

test("a config file that is not JSON is rejected naming the file", () => {
  const path = configFile("{ upstream: ");
  expect(() => readConfig(path)).toThrow(path);
});

test("a config file's bad key is reported with the file path", () => {
  const path = configFile(JSON.stringify({ launch: { copilot: [] } }));
  expect(() => readConfig(path)).toThrow(`${path}: launch.copilot must be a non-empty array of non-empty strings`);
});
