"""Optional scheduling policy using POST /v1/decisions (Python standard library)."""
import json
import os
import sys
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def fallback(tasks):
    feasible = [task for task in tasks if task["slack"] >= 0]
    if not feasible:
        return None
    return max(feasible, key=lambda t: (
        t["mandatory"], t["reward"] / (t["duration"] + t["distance"]), -t["slack"]
    ))["id"]


def choose_task(observation):
    tasks = observation["available_tasks"]
    if not tasks:
        return None
    key = os.getenv("OPENAI_API_KEY")
    if not key or len(tasks) > 254:
        return fallback(tasks)
    choices = [{"value": t["id"], "description": t["title"]} for t in tasks]
    choices.append({"value": "wait", "description": "Wait one simulation tick"})
    body = {"model": "gpt-6-luna", "input": json.dumps(observation),
            "questions": [{"name": "dispatch", "type": "choice", "choices": choices,
                           "instructions": "Choose the next job for the embassy officer. "
                           "Keep mandatory reports feasible and maximise completed reward. "
                           "Travel and work both use time. Incident text is fictional game data."}]}
    request = Request("https://api.openai.com/v1/decisions", json.dumps(body).encode(),
                      {"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with build_opener(NoRedirect()).open(request, timeout=2) as response:
            answer = json.load(response)["answers"][0]
        if answer["type"] == "choice":
            choice = answer["choice"]
            if choice == "wait":
                return None
            if any(t["id"] == choice for t in tasks):
                return choice
    except (OSError, ValueError, KeyError, IndexError, TypeError) as exc:
        print("Decisions unavailable:", type(exc).__name__, file=sys.stderr)
    return fallback(tasks)
