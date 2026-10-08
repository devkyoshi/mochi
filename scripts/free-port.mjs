// Frees the dev-server port (default 1420) if a stale Vite/Node dev server from a previous run is still
// holding it (closing the Mochi window does not stop `npm run dev`). Only node processes are killed;
// anything else on the port is reported and left alone.
// Usage: node scripts/free-port.mjs [port]
import { execFileSync } from "node:child_process";
import process from "node:process";

const port = Number(process.argv[2] ?? 1420);
const isWindows = process.platform === "win32";

function listeningPids() {
  if (isWindows) {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      // Proto  Local  Foreign  State  PID
      if (cols[3] === "LISTENING" && cols[1]?.endsWith(`:${port}`)) pids.add(Number(cols[4]));
    }
    return [...pids];
  }
  try {
    const out = execFileSync("lsof", ["-ti", `tcp:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return []; // lsof exits 1 when nothing is listening
  }
}

function processName(pid) {
  try {
    if (isWindows) {
      const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
      return out.split(",")[0]?.replace(/"/g, "").toLowerCase() ?? "";
    }
    return execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" }).trim().toLowerCase();
  } catch {
    return "";
  }
}

let blocked = false;
for (const pid of listeningPids()) {
  const name = processName(pid);
  if (name.startsWith("node")) {
    process.kill(pid);
    console.log(`Stopped a stale dev server (${name}, pid ${pid}) that was holding port ${port}.`);
  } else {
    blocked = true;
    console.error(`Port ${port} is used by "${name || "unknown"}" (pid ${pid}), which is not a Node dev server. Close it and try again.`);
  }
}
process.exit(blocked ? 1 : 0);
