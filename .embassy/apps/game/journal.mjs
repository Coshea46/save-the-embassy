import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";

import { homedir } from "node:os";

// SQLite's OS-backed writer lock releases on process death, including SIGKILL.
// The database contains no participant data. Acquire only on official join or
// recovery, outside the simulation loop, on the supported Node 22.13+ runtime.
let profileLock;
async function claimProfile(dir) {
  if (profileLock) return;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const { DatabaseSync } = await import("node:sqlite");
  if (profileLock) return;
  const lease = new DatabaseSync(join(dir, "launcher-lock.sqlite"));
  try {
    lease.exec("BEGIN IMMEDIATE");
    profileLock = lease;
  } catch (error) {
    lease.close();
    if (error.errcode !== 5) throw error;
    throw new Error(
      "Another launcher is using your competition journal. Close it to resume here.",
      { cause: error },
    );
  }
}

export function credentialStore(base, workshop) {
  const dir = join(homedir(), ".embassy-dispatch");
  const file = join(
    dir,
    createHash("sha256")
      .update(base + "|" + workshop)
      .digest("hex") + ".json",
  );
  return {
    base,
    workshop,
    async load() {
      await claimProfile(dir);
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return {};
        throw error;
      }
    },
    async save(state) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const temp = file + "." + randomUUID();
      await writeFile(temp, JSON.stringify(state), {
        mode: 0o600,
        flush: true,
      });
      await rename(temp, file);
    },
  };
}

// Only v2 journals carry their service origin. Resume locally even if the API is down.
export async function savedWorkshops() {
  const dir = join(homedir(), ".embassy-dispatch");
  let files;
  try {
    files = await readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  const saved = [];
  for (const name of files.filter((n) => /^[a-f0-9]{64}\.json$/.test(n))) {
    const file = join(dir, name);
    let data;
    try {
      data = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      console.error(
        "An unreadable workshop journal was preserved in your profile:",
        name,
      );
      continue;
    }
    if (data.assignment && data.base && !data.finished)
      saved.push({
        base: data.base,
        workshop: data.workshop,
        mtime: (await stat(file)).mtimeMs,
      });
  }
  return saved.sort((a, b) => a.mtime - b.mtime);
}
