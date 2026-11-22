# ==========================================
#  YOUR AI AGENT — EDIT THIS FILE!
# ==========================================
#
# Your goal: get the highest score.
#
# Use Codex to improve choose_next_task().
# Everything else is handled for you.


def choose_next_task(observation: dict) -> str | None:
    """Choose which task your AI agent should do next.

    observation tells you where your agent is and which tasks are available.
    Each task has a priority, deadline, reward, duration and travel distance.
    Return the ID of the task you want to complete, or None to wait one tick.
    """
    tasks = observation["available_tasks"]
    if not tasks:
        return None

    return max(tasks, key=lambda task: task["priority"])["id"]
