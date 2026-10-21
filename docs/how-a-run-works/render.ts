import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = import.meta.dir;
const width = 860;
const height = 545;

for (const theme of ["light", "dark"]) {
  const out = join(dir, `${theme}.png`);
  rmSync(out, { force: true });
  const proc = Bun.spawnSync(
    [
      chrome,
      "--headless",
      `--screenshot=${out}`,
      `--window-size=${width},${height}`,
      "--force-device-scale-factor=2",
      "--hide-scrollbars",
      "--default-background-color=00000000",
      `file://${join(dir, "index.html")}?theme=${theme}`,
    ],
    { stdout: "ignore", stderr: "pipe" },
  );
  if (proc.exitCode !== 0 || !existsSync(out)) {
    console.error(`chrome failed for ${theme} (exit ${proc.exitCode})\n${proc.stderr.toString()}`);
    process.exit(1);
  }
  console.log(out);
}
