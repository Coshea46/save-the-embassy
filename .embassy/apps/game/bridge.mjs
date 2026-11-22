import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { observationSchema } from "@embassy/contracts";

const worker = fileURLToPath(
  new URL("./python/bridge/worker.py", import.meta.url),
);
export class PythonBridge {
  #child;
  #pending = null;
  #serial = 0;
  #closed = false;
  #timeout;
  #exit;
  constructor({
    python = process.env.EMBASSY_PYTHON ||
      (process.platform === "win32" ? "python" : "python3"),
    timeout = 3000,
    script = worker,
  } = {}) {
    this.#timeout = timeout;
    this.#child = spawn(python, ["-u", script], {
      stdio: ["pipe", "pipe", "inherit"],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    this.#exit = new Promise((resolve) => this.#child.once("close", resolve));
    this.#child.on("error", (e) => this.#abort(e));
    this.#child.stdin.on("error", (e) => this.#abort(e));
    this.#child.once("close", () => this.#abort(new Error("Worker closed")));
    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => {
      try {
        const reply = JSON.parse(line);
        const p = this.#pending;
        if (!p || reply.id !== p.id || typeof reply.ok !== "boolean")
          throw new Error("Invalid worker response");
        if (!reply.ok && typeof reply.error !== "string")
          throw new Error("Malformed worker error");
        if (reply.ok && reply.result !== null && !p.allowed.has(reply.result))
          throw new Error("Invalid worker result");
        clearTimeout(p.timer);
        this.#pending = null;
        if (reply.ok) p.resolve(reply.result);
        else p.reject(new Error(reply.error));
      } catch (e) {
        this.#abort(e);
      }
    });
  }
  #abort(error) {
    this.#closed = true;
    if (this.#pending) {
      clearTimeout(this.#pending.timer);
      this.#pending.reject(error);
      this.#pending = null;
    }
    if (this.#child.exitCode === null && !this.#child.killed)
      this.#child.kill("SIGKILL");
  }
  #send(op, observation) {
    if (this.#closed || this.#pending)
      return Promise.reject(new Error("Worker closed or busy"));
    const id = ++this.#serial;
    const allowed = new Set(observation?.available_tasks.map((t) => t.id));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.#abort(new Error("Worker timeout")),
        this.#timeout,
      );
      this.#pending = { id, resolve, reject, timer, allowed };
      this.#child.stdin.write(JSON.stringify({ id, op, observation }) + "\n");
    });
  }
  reset() {
    return this.#send("reset");
  }
  choose(observation) {
    return this.#send("choose", observationSchema.parse(observation));
  }
  async close() {
    try {
      if (!this.#closed) await this.#send("shutdown");
    } finally {
      this.#closed = true;
      this.#child.stdin.end();
      const timer = setTimeout(
        () => this.#abort(new Error("Shutdown timeout")),
        this.#timeout,
      );
      try {
        await this.#exit;
      } finally {
        clearTimeout(timer);
      }
    }
  }
}
