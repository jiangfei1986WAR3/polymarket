import { app, BrowserWindow, dialog, shell } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const desktopRuntimeRoot = path.join(projectRoot, "runtime_state", "electron_desktop");
const guiStdoutLogPath = path.join(desktopRuntimeRoot, "logs", "gui_server.stdout.log");
const guiStderrLogPath = path.join(desktopRuntimeRoot, "logs", "gui_server.stderr.log");
const desktopStartupLogPath = path.join(desktopRuntimeRoot, "logs", "desktop_startup.log");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resetFile(filePath) {
  fs.writeFileSync(filePath, "", "utf8");
}

function appendLog(filePath, message) {
  fs.appendFileSync(filePath, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function configureElectronPaths() {
  const appDataPath = path.join(desktopRuntimeRoot, "appData");
  const userDataPath = path.join(desktopRuntimeRoot, "userData");
  const sessionDataPath = path.join(desktopRuntimeRoot, "sessionData");
  const cachePath = path.join(desktopRuntimeRoot, "cache");
  const logsPath = path.join(desktopRuntimeRoot, "logs");

  [desktopRuntimeRoot, appDataPath, userDataPath, sessionDataPath, cachePath, logsPath].forEach(ensureDir);
  app.setPath("appData", appDataPath);
  app.setPath("userData", userDataPath);
  app.setPath("sessionData", sessionDataPath);
  app.setPath("cache", cachePath);
  app.setAppLogsPath(logsPath);
}

function parseArgs(argv) {
  const out = {
    configFile: path.join(projectRoot, "app_config.json"),
    host: "127.0.0.1",
    port: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case "--config":
      case "--file":
        out.configFile = path.resolve(next);
        i += 1;
        break;
      case "--host":
        out.host = next;
        i += 1;
        break;
      case "--port":
        out.port = Math.max(0, Number(next));
        i += 1;
        break;
      default:
        break;
    }
  }

  return out;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGetOk(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const statusCode = res.statusCode ?? 0;
      res.resume();
      if (statusCode >= 200 && statusCode < 300) {
        resolve();
        return;
      }
      reject(new Error(`Health check returned HTTP ${statusCode}`));
    });
    req.on("error", reject);
  });
}

async function waitForServer(url, options = {}) {
  const attempts = options.attempts ?? 120;
  const delayMs = options.delayMs ?? 500;
  const readyUrl = new URL("api/health", url).toString();
  for (let i = 0; i < attempts; i += 1) {
    try {
      await httpGetOk(readyUrl);
      appendLog(desktopStartupLogPath, `GUI health check passed: ${readyUrl}`);
      return;
    } catch (error) {
      appendLog(
        desktopStartupLogPath,
        `GUI health check retry ${i + 1}/${attempts} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (options.child && options.child.exitCode !== null) {
      throw new Error(
        `GUI server exited before health check passed. 请查看日志：${guiStdoutLogPath} 和 ${guiStderrLogPath}`,
      );
    }
    await delay(delayMs);
  }
  throw new Error(
    `Timed out waiting for GUI server: ${url}\n请查看日志：${guiStdoutLogPath}\n${guiStderrLogPath}\n${desktopStartupLogPath}`,
  );
}

function spawnGuiServer(options) {
  const require = createRequire(import.meta.url);
  const tsxCliPath = require.resolve("tsx/cli");
  const guiServerPath = path.join(projectRoot, "src", "gui_server.ts");
  const args = [tsxCliPath, guiServerPath, "--config", options.configFile, "--host", options.host, "--port", String(options.port)];

  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const consumeStdout = (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }
        appendLog(guiStdoutLogPath, line);
        try {
          const parsed = JSON.parse(line);
          if (parsed.mode === "app_gui_server_started" && parsed.url) {
            settled = true;
            resolve({
              child,
              url: parsed.url,
              startup: parsed,
            });
          }
        } catch {
          // Keep reading log lines until startup JSON appears.
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      consumeStdout(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      appendLog(guiStderrLogPath, chunk.trimEnd());
    });

    child.on("error", fail);
    child.on("exit", (code) => {
      if (stdoutBuffer.trim()) {
        consumeStdout("\n");
      }
      appendLog(desktopStartupLogPath, `GUI child exited with code ${code ?? 0}`);
      if (!settled) {
        fail(
          new Error(
            stderr.trim() ||
              `GUI server exited early with code ${code}. 请查看日志：${guiStdoutLogPath} 和 ${guiStderrLogPath}`,
          ),
        );
      }
    });
  });
}

let mainWindow = null;
let guiProcess = null;

configureElectronPaths();
resetFile(guiStdoutLogPath);
resetFile(guiStderrLogPath);
resetFile(desktopStartupLogPath);

async function createMainWindow() {
  const options = parseArgs(process.argv.slice(1));
  appendLog(desktopStartupLogPath, `Desktop shell starting with config ${options.configFile}`);
  const server = await spawnGuiServer(options);
  guiProcess = server.child;
  appendLog(desktopStartupLogPath, `GUI server announced startup at ${server.url}`);
  await waitForServer(server.url, { child: guiProcess });

  const preloadPath = path.join(__dirname, "preload.mjs");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1180,
    minHeight: 760,
    autoHideMenuBar: true,
    title: "Polymarket TS Executor",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(server.url);
}

function stopGuiProcess() {
  if (guiProcess && !guiProcess.killed) {
    guiProcess.kill();
  }
  guiProcess = null;
}

app.on("before-quit", () => {
  stopGuiProcess();
});

app.whenReady().then(async () => {
  try {
    await createMainWindow();
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "Polymarket TS Executor",
      message: "桌面壳启动失败",
      detail: error instanceof Error ? error.stack ?? error.message : String(error),
    });
    app.exit(1);
  }
});

app.on("window-all-closed", () => {
  stopGuiProcess();
  app.quit();
});
