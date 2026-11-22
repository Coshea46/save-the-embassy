import io
import json
import os
import unittest
from unittest.mock import patch

from decisions_example import choose_task

TASK = dict(id="report-1", title="Sample", slack=7, mandatory=True, reward=75,
            duration=3, distance=2, priority=7, description="A sample report.")


class DecisionsTests(unittest.TestCase):
    def test_live_shape_and_task_id(self):
        def send(req, timeout):
            body = json.loads(req.data)
            self.assertEqual(req.full_url, "https://api.openai.com/v1/decisions")
            self.assertEqual(body["model"], "gpt-6-luna")
            choices = body["questions"][0]["choices"]
            self.assertEqual([c["value"] for c in choices], ["report-1", "wait"])
            self.assertEqual(json.loads(body["input"])["available_tasks"][0], TASK)
            return io.BytesIO(b'{"answers":[{"type":"choice","choice":"report-1"}]}')
        with patch.dict(os.environ, {"OPENAI_API_KEY":"test-only"}), patch("decisions_example.build_opener") as opener:
            opener.return_value.open.side_effect = send
            self.assertEqual(choose_task({"available_tasks":[TASK]}), "report-1")

    def test_failure_refusal_and_offline(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY":"test-only"}), patch("decisions_example.build_opener") as opener:
            opener.return_value.open.side_effect = [TimeoutError(), io.BytesIO(b'{"answers":[{"type":"refusal"}]}')]
            for _ in range(2):
                self.assertEqual(choose_task({"available_tasks":[TASK]}), TASK["id"])
        with patch.dict(os.environ, {"OPENAI_API_KEY":""}):
            self.assertIsNone(choose_task({"available_tasks":[]}))
            self.assertIsNone(choose_task({"available_tasks":[dict(TASK, slack=-1)]}))
