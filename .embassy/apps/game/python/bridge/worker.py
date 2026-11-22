"""Private newline-delimited JSON channel to a locally launched game."""
import asyncio
import importlib.util
import inspect
import json
import os
import sys
from contextlib import redirect_stdout
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[4]
AGENT_FILE = WORKSPACE.parent / "agent.py"
sys.path[:0] = [str(AGENT_FILE.parent), str(WORKSPACE)]


class EmbassyAgent:
    def __init__(self):
        # Read the source on reset, even for same-size edits within one second
        # that Python's timestamp-based bytecode cache could otherwise miss.
        spec = importlib.util.spec_from_file_location("agent", AGENT_FILE)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        exec(compile(AGENT_FILE.read_bytes(), str(AGENT_FILE), "exec"), module.__dict__)
        self.choose_next_task = module.choose_next_task

        if os.getenv("EMBASSY_DECISIONS") == "1":
            from apps.game.python.decisions_example import choose_task
            self.choose_next_task = choose_task


def handle(agent, request, loop):
    action = request["op"]
    if action == "reset":
        return EmbassyAgent(), None
    if action == "shutdown":
        return agent, None
    if action != "choose":
        raise ValueError("Unknown operation")
    if agent is None:
        raise ValueError("Reset required before choose")
    observation = request["observation"]
    selected = agent.choose_next_task(observation)
    if inspect.isawaitable(selected):
        selected = loop.run_until_complete(selected)
    if selected is not None and (not isinstance(selected, str) or
            selected not in {t["id"] for t in observation["available_tasks"]}):
        raise ValueError("Expected an available task ID or None")
    return agent, selected


def serve(reader, writer):
    agent = None
    with asyncio.Runner() as runner:
        for line in reader:
            request_id = None
            stop = False
            try:
                request = json.loads(line)
                request_id = request["id"]
                if type(request_id) is not int or request_id < 1:
                    raise ValueError("Expected a positive integer request ID")
                with redirect_stdout(sys.stderr):
                    agent, result = handle(agent, request, runner.get_loop())
                response = {"id": request_id, "ok": True, "result": result}
                stop = request["op"] == "shutdown"
            except Exception as exc:
                response = {"id": request_id, "ok": False,
                            "error": f"{type(exc).__name__}: {exc}"}
            writer.write(json.dumps(response) + "\n")
            writer.flush()
            if stop:
                break


if __name__ == "__main__":
    serve(sys.stdin, sys.stdout)
