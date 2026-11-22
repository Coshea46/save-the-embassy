# Working on Save the Finnish Embassy

## Participant requests

The participant’s main file is `/agent.py` at the repository root. When a student asks to improve their agent, edit that file by default. Preserve the `choose_next_task(observation: dict) -> str | None` signature and return an available task ID or `None`. An async function also works. Use the visible observation fields such as slack, mandatory status, reward, duration and actual travel time to improve scheduling. Module-level variables last for one run.

Do not modify the simulation engine to increase scores. Do not alter scoring formulas, deadlines, official competition rules, the backend or the leaderboard. Run relevant tests after changes, including `npm run test:python`, and compare the strategy with `npm run agent:benchmark -- 1,7,42,2026`.

## Repository development

Read docs/ARCHITECTURE.md for the ownership table and package exports. Use npm workspaces from the repository root. Build before importing packages in Node. Commit the root lockfile with dependency changes. Run npm ci, npm run typecheck, npm run lint, npm test, npm run test:python and npm run build before submitting.

All decisions go through @embassy/simulation. Keep scheduling, navigation, score and replay edits in that package. Update the ruleset identifier for behavioural changes. Keep versioned competition scenarios available for replay. A changed golden fixture needs a documented rules change. Preserve the observable Python protocol and use original assets.

The game session owns apps/game, the catalogue data in packages/tasks/src, and docs/WORKSHOP.md. The platform session owns apps/api, apps/leaderboard, Supabase migrations and deployment configuration, and docs/API.md. Each session branches from the same reviewed foundation and opens its own PR. Coordinate shared engine or contract changes in a separate PR before consuming them.

Keep participant tokens local and organiser credentials server-side. Public leaderboard projections must contain only fields in the leaderboard contract.
