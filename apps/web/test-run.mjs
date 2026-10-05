import { spawn } from "node:child_process";
import { join } from "node:path";

const pythonPath = join(process.cwd(), "../../engine/.tools/env/bin/python");
const script = "from splicr.private_screen import process_one; process_one()";
const proc = spawn(pythonPath, ["-c", script], {
  cwd: join(process.cwd(), "../../engine"),
  env: { ...process.env, PYTHONPATH: "." },
  detached: true,
  stdio: "inherit"
});
proc.unref();
