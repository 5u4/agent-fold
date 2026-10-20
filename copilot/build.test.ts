import { expect, test } from "bun:test";
import { buildExtension, EXTENSION_PATH } from "./build";

test("the committed extension.mjs is the current build of extension.ts", async () => {
  expect(await Bun.file(EXTENSION_PATH).text()).toBe(await buildExtension());
});
