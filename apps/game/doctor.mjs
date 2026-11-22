import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let problems = 0;
function check(name, valid, message, required = true) {
  console.log(
    (valid ? "OK   " : required ? "FIX  " : "NOTE ") + name + " — " + message,
  );
  if (!valid && required) problems++;
}
const [major, minor] = process.versions.node.split(".").map(Number);
check(
  "Node",
  major > 22 || (major === 22 && minor >= 13),
  process.version + " (need 22.13+; workshop uses 24)",
);
const py =
  process.env.EMBASSY_PYTHON ||
  (process.platform === "win32" ? "python" : "python3");
const result = spawnSync(
  py,
  [
    "-c",
    "import sys; print(sys.version.split()[0]); sys.exit(sys.version_info < (3,11))",
  ],
  { encoding: "utf8" },
);
check(
  "Python",
  result.status === 0,
  py + " " + (result.stdout?.trim() || "unavailable") + " (need 3.11+)",
);
check(
  "Git",
  spawnSync("git", ["--version"]).status === 0,
  "git --version",
  false,
);
check(
  "Participant agent",
  existsSync(new URL("../../agent.py", import.meta.url)),
  "agent.py (repository root)",
);
let installed;
try {
  installed = require.resolve("typescript/bin/tsc");
} catch {
  installed = null;
}
check(
  "Workspace dependencies",
  Boolean(installed),
  installed ? "installed" : "run npm ci in the repository root",
);
console.log(
  "Editor check: in VS Code, open Extensions and search @installed Codex (OpenAI).",
);
process.exitCode = problems ? 1 : 0;
