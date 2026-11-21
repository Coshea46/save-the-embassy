import io
import json
import unittest
from unittest.mock import patch
from agent import EmbassyAgent
from bridge.worker import serve


def run(requests):
    reader = io.StringIO("".join(json.dumps(dict(id=i, **r)) + "\n"
                                 for i, r in enumerate(requests, start=1)))
    output = io.StringIO()
    serve(reader, output)
    return [json.loads(line) for line in output.getvalue().splitlines()]


class WorkerTests(unittest.TestCase):
    def test_baseline(self):
        agent = EmbassyAgent()
        self.assertIsNone(agent.choose_next_task({"available_tasks": []}))
        self.assertEqual(agent.choose_next_task({"available_tasks": [
            {"id": "a", "priority": 4}, {"id": "b", "priority": 10}]}), "b")
        self.assertEqual(agent.decisions_made, 2)

    def test_async_memory_and_reset(self):
        class Counting(EmbassyAgent):
            async def choose_next_task(self, observation):
                self.decisions_made += 1
                return str(self.decisions_made)
        choose = {"op": "choose", "observation": {"available_tasks": [{"id": "1"}, {"id": "2"}]}}
        with patch("bridge.worker.EmbassyAgent", Counting):
            replies = run([{"op": "reset"}, choose, choose, {"op": "reset"}, choose, {"op": "shutdown"}, choose])
        self.assertEqual([r["result"] for r in replies], [None, "1", "2", None, "1", None])
        self.assertEqual([r["id"] for r in replies], list(range(1, 7)))

    def test_bad_return_exception_and_protocol_error(self):
        choose = {"op": "choose", "observation": {"available_tasks": []}}
        with patch.object(EmbassyAgent, "choose_next_task", side_effect=["missing", RuntimeError("oops")]):
            replies = run([{"op": "reset"}, choose, choose, {"op": "unknown"}])
        self.assertEqual([r["ok"] for r in replies], [True, False, False, False])
        self.assertIn("RuntimeError", replies[2]["error"])
