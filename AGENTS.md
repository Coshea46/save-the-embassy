# Working on Save the Finnish Embassy

Read docs/ARCHITECTURE.md for the ownership table and package exports. Use npm workspaces from the repository root. Build before importing packages in Node. Commit the root lockfile with dependency changes. Run npm ci, npm run typecheck, npm run lint, npm test, npm run test:python and npm run build before submitting.

All decisions go through @embassy/simulation. Keep scheduling, navigation, score and replay edits in that package. Update the ruleset identifier for behavioural changes. Keep versioned competition scenarios available for replay. A changed golden fixture needs a documented rules change. Preserve the observable Python protocol and use original assets.

The game session owns apps/game, the catalogue data in packages/tasks/src, and docs/WORKSHOP.md. The platform session owns apps/api, apps/leaderboard, Supabase migrations and deployment configuration, and docs/API.md. Each session branches from the same reviewed foundation and opens its own PR. Coordinate shared engine or contract changes in a separate PR before consuming them.

Keep participant tokens local and organiser credentials server-side. Public leaderboard projections must contain only fields in the leaderboard contract.
