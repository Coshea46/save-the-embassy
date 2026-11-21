import { spawnSync } from "node:child_process";

const python = process.env.EMBASSY_PYTHON || (process.platform === "win32" ? "python" : "python3");
const result = spawnSync(python, ["-m", "unittest", "discover", "-s", "apps/game/python", "-p", "test_*.py"], { stdio: "inherit" });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
