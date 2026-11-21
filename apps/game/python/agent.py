import os


class EmbassyAgent:
    def __init__(self):
        # This object lives for one game. Keep your strategy's memory here.
        self.decisions_made = 0

    def choose_next_task(self, observation: dict) -> str | None:
        """Return a task ID, or None to wait one simulation tick."""
        self.decisions_made += 1
        if os.getenv("EMBASSY_DECISIONS") == "1":
            from decisions_example import choose_task
            return choose_task(observation)
        tasks = observation["available_tasks"]
        if not tasks:
            return None
        return max(tasks, key=lambda task: task["priority"])["id"]
