import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const runtimeRoot = path.join(projectRoot, "runtime_state");
const electronCache = path.join(runtimeRoot, "electron_cache");
const builderCache = path.join(runtimeRoot, "electron_builder_cache");
const tempRoot = path.join(runtimeRoot, "electron_builder_tmp");

for (const dir of [runtimeRoot, electronCache, builderCache, tempRoot]) {
  fs.mkdirSync(dir, { recursive: true });
}

const child = spawn(
  process.execPath,
  [path.join(projectRoot, "node_modules", "electron-builder", "cli.js"), ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_CACHE: electronCache,
      ELECTRON_BUILDER_CACHE: builderCache,
      TEMP: tempRoot,
      TMP: tempRoot,
    },
    stdio: "inherit",
    windowsHide: false,
  },
);

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
