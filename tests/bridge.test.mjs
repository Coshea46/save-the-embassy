import test from "node:test";
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PythonBridge } from "../apps/game/bridge.mjs";
import { Simulation, createScenario } from "@embassy/simulation";
test("real Python worker receives validated observations and resets cleanly", async () => {
  const bridge = new PythonBridge();
  const obs = new Simulation(createScenario(7)).observe();
  try {
    await assert.rejects(bridge.choose(obs), /Reset required/);
    await bridge.reset();
    assert.throws(() => bridge.choose({ ...obs, simulation_time: -1 }));
    assert.equal(await bridge.choose(obs), "report-1");
    await bridge.reset();
    assert.equal(await bridge.choose({ ...obs, available_tasks: [] }), null);
  } finally {
    await bridge.close();
  }
});
test("host kills timed out or malformed workers and releases their process handles", async () => {
  const dir = await mkdtemp(join(tmpdir(), "embassy-"));
  try {
    for (const [source, message] of [
      ["import time\ntime.sleep(30)", "timeout"],
      ['input()\nprint("oops",flush=True)', "JSON"],
      [
        'input()\nprint(\'{"id":1,"ok":true,"result":17}\',flush=True)',
        "Invalid worker result",
      ],
    ]) {
      const script = join(dir, "worker.py");
      await writeFile(script, source);
      const bridge = new PythonBridge({
        script,
        timeout: source.includes("sleep") ? 100 : 3000,
      });
      await assert.rejects(bridge.reset(), new RegExp(message, "i"));
      await bridge.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a stalled participant function times out during a decision", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "embassy-agent-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const folder = join(dir, "apps", "game", "python", "bridge");
  await mkdir(folder, { recursive: true });
  const script = join(folder, "worker.py");
  await copyFile(new URL("../apps/game/python/bridge/worker.py", import.meta.url), script);
  await writeFile(join(dir, "agent.py"), "import time\ndef choose_next_task(obs): time.sleep(30)\n");
  const bridge = new PythonBridge({ script, timeout: 3000 });
  try {
    await bridge.reset();
    await assert.rejects(bridge.choose(new Simulation(createScenario(7)).observe()), /timeout/i);
  } finally {
    await bridge.close();
  }
});
