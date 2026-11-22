# ==========================================
#  YOUR AI AGENT — EDIT THIS FILE!
# ==========================================
#
# Your goal: get the highest score.
#
# Use Codex to improve choose_next_task().
# Everything else is handled for you.
#
#
# ==========================================
#  HOW YOUR AGENT WORKS
# ==========================================
#
# Your agent receives an "observation" containing information
# about the current game and the tasks available.
#
# Your job is to decide WHICH task to complete next.
#
# The game automatically handles:
# - Moving your character to the task
# - Finding the shortest path
# - Completing the task
# - Calculating your score
#
# You only need to return the ID of your chosen task.
#
#
# ==========================================
#  WHAT DOES THE OBSERVATION LOOK LIKE?
# ==========================================
#
# observation is a Python dictionary with this structure:
#
# {
#     "simulation_time": 120,
#
#     "agent": {
#         "position": {"x": 14, "y": 8},
#         "current_task_id": None
#     },
#
#     "available_tasks": [
#         {
#             "id": "report-001",
#             "title": "Broken boiler",
#             "description": "The embassy heating system has broken down.",
#             "priority": 9,
#             "reward": 100,
#             "mandatory": True,
#             "time_remaining": 40,
#             "duration": 10,
#             "position": {"x": 5, "y": 8},
#             "distance": 12,
#             "estimated_travel_time": 12,
#             "slack": 18,
#             "urgency": "urgent"
#         },
#
#         {
#             "id": "report-002",
#             "title": "Coffee machine malfunction",
#             "description": "The coffee machine has stopped dispensing coffee.",
#             "priority": 5,
#             "reward": 60,
#             "mandatory": False,
#             "time_remaining": 90,
#             "duration": 8,
#             "position": {"x": 16, "y": 10},
#             "distance": 4,
#             "estimated_travel_time": 4,
#             "slack": 78,
#             "urgency": "normal"
#         }
#     ]
# }
#
# This is an example, not an actual game state.
# The number of available tasks will change throughout the game.
#
#
# ==========================================
#  TASK FIELDS EXPLAINED
# ==========================================
#
# tasks = observation["available_tasks"]
#
# tasks is a list of dictionaries:
#
#     list[dict]
#
# Each dictionary represents one available task.
#
# Field                   Type       Meaning
# --------------------------------------------------------------
# id                      str        Unique task identifier
# title                   str        Short name of the task
# description             str        Description of the problem
# priority                int        Importance (1-10)
# reward                  int        Points for completing the task
# mandatory               bool       If True, missing it ends the game
# time_remaining          int        Seconds until the deadline
# duration                int        Seconds needed to complete the task
# position                dict       Task coordinates: {"x": int, "y": int}
# distance                int        Shortest walkable distance to task
# estimated_travel_time   int        Seconds needed to reach the task
# slack                   int        Time left after travelling and working
# urgency                 str        normal / urgent / very_urgent / critical
#
# NOTE: All times use simulated game seconds, not real-world time.
#
# Slack is calculated as:
#
#     slack = time_remaining - estimated_travel_time - duration
#
# For example:
#
#     time_remaining = 40
#     estimated_travel_time = 12
#     duration = 10
#
#     slack = 40 - 12 - 10 = 18
#
# A negative slack means the task cannot be finished before its
# deadline if you start travelling to it right now.
#
#
# ==========================================
#  YOUR FUNCTION
# ==========================================
#
# You can use any algorithm you like!
#
# Some ideas:
# - Always pick the highest-priority task
# - Choose the task with the nearest deadline
# - Prefer tasks with higher rewards
# - Account for travel distance and work duration
# - Combine multiple factors into a scoring formula
# - Use OpenAI's Decisions API (optional)
#
# Remember: The highest-priority task is not always the best choice.
#
# Return:
# - A task's "id" (str) to select that task
# - None to wait one simulated second
#
# You can use Codex to rewrite the function below or do it manually!


def choose_next_task(observation: dict) -> str | None:
    """
    Decide which task your AI agent should complete next.

    Args:
        observation (dict):
            The current game state, including your agent's position
            and the list of available tasks.

    Returns:
        str | None:
            The ID of the task to complete, or None to wait.
    """

    tasks = observation["available_tasks"]

    if not tasks:
        return None

    # Starter strategy: choose the highest-priority task.
    return max(tasks, key=lambda task: task["priority"])["id"]