"""Private newline-delimited JSON channel to a locally launched game."""
import asyncio
import inspect
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
def EmbassyAgent():
    # Import inside the request so a syntax/import error reaches the browser.
    from agent import EmbassyAgent as Agent
    return Agent()


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
