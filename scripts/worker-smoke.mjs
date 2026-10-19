import { spawn } from "node:child_process";
if (!process.env.DATABASE_URL?.endsWith("/crm_validation")) throw new Error("Worker smoke only runs on crm_validation.");
let output = "";
const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "src/worker.ts"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (data) => { output += data; });
child.stderr.on("data", (data) => { output += data; });
let exited = false;
child.on("exit", () => { exited = true; });
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (exited) throw new Error(`Worker exited early:\n${output}`);
    if (output.includes("[worker] automações e campanhas iniciadas")) {
      if (!output.includes("fila Redis/BullMQ conectada") || output.includes("[worker:")) throw new Error(`Worker processing failed:\n${output}`);
      console.log("WORKER_SMOKE_OK: production runtime, Redis queue, PostgreSQL periodic processors.");
      break;
    }
    if (attempt === 99) throw new Error(`Worker startup timeout:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
} finally { if (!exited) child.kill("SIGTERM"); }
