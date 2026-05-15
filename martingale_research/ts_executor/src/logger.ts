import fs from "node:fs";
import path from "node:path";

import type { ExecutionEvent } from "./types.js";

export function appendExecutionEvent(logFile: string, event: ExecutionEvent): void {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, `${JSON.stringify(event)}\n`, "utf8");
}
