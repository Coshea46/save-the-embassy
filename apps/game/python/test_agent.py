import asyncio
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bridge import worker

ROOT = Path(__file__).resolve().parents[3]
TASKS = [{"id": "1", "priority": 2}, {"id": "2", "priority": 7}]
CHOOSE = {"op": "choose", "observation": {"available_tasks": TASKS}}
RESET = {"op": "reset"}


def run(requests):
    reader = io.StringIO("".join(json.dumps(dict(id=i, **r)) + "\n"
                                 for i, r in enumerate(requests, start=1)))
    output = io.StringIO()
    worker.serve(reader, output)
    return [json.loads(line) for line in output.getvalue().splitlines()]


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, {"EMBASSY_DECISIONS": "0"}))
        self.enterContext(patch.dict(sys.modules))

    def temporary_agent(self, source):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        path = Path(directory) / "agent.py"
        path.write_text(source, encoding="utf-8")
        self.enterContext(patch.object(worker, "AGENT_FILE", path))
        return path

    def test_root_import_and_worker_baseline(self):
        import agent
        self.assertEqual(Path(agent.__file__).resolve(), ROOT / "agent.py")
        self.assertEqual(worker.AGENT_FILE, ROOT / "agent.py")
        self.assertIsNone(agent.choose_next_task({"available_tasks": []}))
        self.assertEqual(agent.choose_next_task(CHOOSE["observation"]), "2")
        self.assertEqual(run([RESET, CHOOSE])[-1]["result"], "2")

    def test_async_memory_and_reset(self):
        self.temporary_agent(
            "seen = []\n"
            "async def choose_next_task(observation):\n"
            "    seen.append(len(seen) + 1)\n"
            "    return str(seen[-1])\n"
        )
        replies = run([RESET, CHOOSE, CHOOSE, RESET, CHOOSE, {"op": "shutdown"}, CHOOSE])
        self.assertEqual([r["result"] for r in replies], [None, "1", "2", None, "1", None])
        self.assertEqual([r["id"] for r in replies], list(range(1, 7)))

    def test_edit_becomes_visible_only_after_reset(self):
        path = self.temporary_agent("def choose_next_task(obs): return '1'\n")
        original_time = path.stat().st_mtime_ns
        with asyncio.Runner() as runner:
            loop = runner.get_loop()
            agent, _ = worker.handle(None, RESET, loop)
            path.write_text("def choose_next_task(obs): return '2'\n", encoding="utf-8")
            os.utime(path, ns=(original_time, original_time))
            self.assertEqual(worker.handle(agent, CHOOSE, loop)[1], "1")
            agent, _ = worker.handle(agent, RESET, loop)
            self.assertEqual(worker.handle(agent, CHOOSE, loop)[1], "2")

    def test_bad_return_exception_and_protocol_error(self):
        self.temporary_agent(
            "answers = iter(['missing', 17])\n"
            "def choose_next_task(obs): return next(answers)\n"
        )
        replies = run([RESET, CHOOSE, CHOOSE, CHOOSE, {"op": "unknown"}])
        self.assertEqual([r["ok"] for r in replies], [True, False, False, False, False])
        for reply in replies[1:3]:
            self.assertIn("available task ID", reply["error"])
        self.assertIn("StopIteration", replies[3]["error"])

    def test_root_can_call_decisions_and_opt_in_still_works_offline(self):
        path = self.temporary_agent(
            "from apps.game.python.decisions_example import choose_task\n"
            "def choose_next_task(observation): return choose_task(observation)\n"
        )
        observation = {"available_tasks": [
            dict(TASKS[0], slack=3, reward=2, mandatory=True, duration=1, distance=1),
            dict(TASKS[1], slack=-1),
        ]}
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            for flag in ("0", "1"):
                if flag == "1":
                    path.write_text("def choose_next_task(obs): return None\n", encoding="utf-8")
                with self.subTest(flag=flag), patch.dict(os.environ, {"EMBASSY_DECISIONS": flag}):
                    reply = run([RESET, {"op": "choose", "observation": observation}])[-1]
                    self.assertEqual(reply["result"], "1")
