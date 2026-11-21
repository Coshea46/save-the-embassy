# Save the Finnish Embassy

A Python agent schedules incident reports in a fictional Finnish embassy. When the agent chooses a report, the shared TypeScript simulation walks the character to its interaction point and spends the required work ticks. Complete reports for points. Let a mandatory report expire and the embassy closes.

## Run the Python agent

Install Node.js 24 LTS (or 22.13+) and Python 3.11 or later. From the repository root:

```sh
npm ci
npm run demo
```

Open [agent.py](apps/game/python/agent.py) in VS Code and edit `EmbassyAgent.choose_next_task`. Run the same command again to compare scores on seed 42. Try another seed with `npm run demo -- 7`. This headless demo needs no accounts, credentials or Python packages. The visual game and online leaderboard are the two follow-on development sessions.

## Development

| Command | Result |
| --- | --- |
| `npm run build` | Emit ESM and type declarations for all six workspaces |
| `npm run typecheck` | Check the complete project reference graph |
| `npm run lint` | Check TypeScript and JavaScript sources |
| `npm test` | Run simulation, bridge and platform contract tests |
| `npm run test:python` | Run Python worker and agent tests |
| `npm run benchmark -- 1,7,42,2026` | Run five strategies on identical seed lists |
| `npm run fairness -- 1000` | Compare opportunity, workload and strategy outcomes for seeds 0–999 |

[Workshop instructions](docs/WORKSHOP.md) · [Architecture and workstream ownership](docs/ARCHITECTURE.md) · [Simulation rules](docs/SIMULATION.md) · [Official API and pacing](docs/API.md) · [MIT licence](LICENSE)
