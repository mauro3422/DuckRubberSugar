import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const children = [];

function run(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: isWindows,
    stdio: ["ignore", "pipe", "pipe"],
  });

  children.push(child);

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const suffix = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[dev] ${name} exited with ${suffix}`);
    shutdown(code ?? 1);
  });

  return child;
}

let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill(isWindows ? undefined : "SIGTERM");
    }
  }

  setTimeout(() => process.exit(code), 250);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("[dev] Starting TypeScript watch and DuckSugar ASR/static server.");
console.log("[dev] Open the DuckSugar URL printed by the server. If 5500 is busy, it will try 5501/5510.");

run("tsc", "npx", ["tsc", "--watch", "--preserveWatchOutput"]);
run("asr", "python", ["transcribe_server.py"]);
