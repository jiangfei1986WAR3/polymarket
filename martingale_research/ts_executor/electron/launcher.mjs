import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const electronBinary = path.join(projectRoot, "node_modules", "electron", "dist", "electron.exe");
const runtimeRoot = path.join(projectRoot, "runtime_state", "electron_launcher");

for (const dir of [
  runtimeRoot,
  path.join(runtimeRoot, "appdata"),
  path.join(runtimeRoot, "localappdata"),
  path.join(runtimeRoot, "temp"),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

const env = {
  ...process.env,
  APPDATA: path.join(runtimeRoot, "appdata"),
  LOCALAPPDATA: path.join(runtimeRoot, "localappdata"),
  TEMP: path.join(runtimeRoot, "temp"),
  TMP: path.join(runtimeRoot, "temp"),
};

const args = [
  path.join(projectRoot, "electron", "main.mjs"),
  "--force-color-profile=srgb",
  "--disable-gpu",
  ...process.argv.slice(2),
];

const child = spawn(electronBinary, args, {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
