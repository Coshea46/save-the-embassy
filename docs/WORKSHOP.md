# Your shift at the embassy

Start with the [installation and launch guide](../README.md). Run the starter on seed 42 and note its score and survival time. Then open **apps/game/python/agent.py** in VS Code. This is the participant's file.

## Make one decision

The game constructs one `EmbassyAgent` for a run. It calls `choose_next_task(observation)` when the officer is free. Return an available task's `id` to walk to it and work until completion or expiry. Return `None` to wait one simulated second. A normal method or an `async def` method works. Values kept on `self` survive between decisions. Restarting the shift or reloading the agent resets them. Print statements appear in the terminal.

| What Python sees | Meaning |
| --- | --- |
| `simulation_time`, `agent.position` | The current tick and tile coordinates |
| `available_tasks` | Currently visible jobs, with unique instance IDs, titles, descriptions and coordinates |
| `distance`, `estimated_travel_time` | Length and tick cost of the actual walk around walls and furniture |
| `time_remaining`, `duration` | Ticks until expiry and ticks spent working after arrival |
| `slack`, `urgency` | Time remaining after the walk and work. A job with zero slack succeeds if started now. |
| `priority`, `reward`, `mandatory` | An importance signal, the points paid for completion, and whether expiry closes the embassy |

For example, with 16 seconds left, a nine-tile walk and six seconds of work leave one second of slack. A nearby optional job might pay more, but taking it first could end the shift. New reports can arrive while the officer is busy. Jobs cannot be interrupted.

On the radar, a folded document is an open report. One, two or three pulsing marks indicate slack at or below 30, 15 or 5 seconds. Open **Shift settings** to change these visual bands for practice. The clock advances once per simulation step regardless of frame rate. **Pause**, **Speed** and **Follow agent** change how you watch a local run.

## Ask Codex in the VS Code sidebar

Start each prompt with **“Change only apps/game/python/agent.py.”**

| Experiment | Paste this prompt |
| --- | --- |
| Earliest deadline | “Choose the feasible job whose deadline arrives first. Show me how to test it on seed 42.” |
| Highest priority | “Choose by priority, then break ties by the shortest real travel time. Explain which observation fields you used.” |
| Travel-aware | “Prefer nearby jobs that can finish on time. Explain when a distant mandatory job should come first.” |
| Weighted score | “Combine reward per travel-and-work tick with slack and mandatory risk. Put the weights near the top so I can tune them.” |
| Decisions API | “Read decisions_example.py. Explain how its structured choices map to task IDs, and how I can test the offline fallback.” |
| Hybrid | “Implement a deterministic rule for obvious mandatory jobs. Call the optional Decisions policy only when two feasible alternatives are close.” |
| Benchmark | “Run npm run agent:benchmark -- 1,7,42,2026 on my current agent, try one change, compare identical seeds, then check fresh seeds 11,39,123.” |

Save the file. Click **Restart → Run agent**. Switch the journal to **History** for the reward or expiry of each report. The multi-seed command starts a new Python process per run. In a second VS Code terminal:

```sh
npm run agent:benchmark -- 1,7,42,2026
npm run benchmark -- 1,7,42,2026
```

The first command measures **your Python agent** using the full catalogue. The second runs the five built-in reference policies. The foundation demo and golden replay retain the historical sample catalogue. Flavour changes leave scoring opportunities identical for matching seeds.

## Join an official shift

With the game already running, open the organiser’s invitation link, choose your nickname and select **Join competition → Copy game credentials**. In the local game choose **Competition → Joined on the website**, paste, then select **Join or resume → Run agent**. Use the same invitation and credentials after a disconnect. Your verified score links directly to the public board. Keep the copied credentials private.

For registration entirely inside the game, get these details from your organiser: API base URL, public leaderboard URL, workshop UUID and join code. Stop your local launcher with Ctrl+C. In **PowerShell**, run:

```powershell
$env:EMBASSY_API_URL = Read-Host "Paste the organiser's API base URL"
$env:EMBASSY_LEADERBOARD_URL = Read-Host "Paste the public leaderboard URL"
npm.cmd start
```

On **macOS or Linux**, run:

```sh
printf 'API base URL: '; read -r EMBASSY_API_URL
printf 'Leaderboard URL: '; read -r EMBASSY_LEADERBOARD_URL
export EMBASSY_API_URL EMBASSY_LEADERBOARD_URL
npm start
```

1. Open the printed local address and select **Competition → Official workshop**. Enter the nickname to publish, workshop ID and join code. Select **Join or resume**, then **Run agent**.
2. The server assigns the scenario and owns the clock, score and deadlines. After each accepted decision the map replays the tiles actually travelled. Scores and visible reports update at the server’s decision boundaries. Server pacing messages are normal. A local pause does not extend the competition's submission window.
3. On a dropped connection, use **Retry**. The launcher journals each pending request and resends the same identifier. After a launcher restart, join the same workshop to resume the same participant and run. Python class memory starts fresh after a process restart.
4. Wait for **Score verified** after the server's finish receipt. Open **Central leaderboard** for the standings. If the organiser enabled multiple attempts, choose **Start another official attempt** after verification. The leaderboard keeps your best eligible result. The local rehearsal is always marked unranked.

The launcher stores the participant token and pending request in your user profile under `.embassy-dispatch`. Use one running launcher per workshop and keep that folder private. Only the configured competition server receives your participant token.

## Optional OpenAI Decisions strategy

The starter works offline by default. The example in [decisions_example.py](../apps/game/python/decisions_example.py) sends the visible observation through Python to `POST /v1/decisions` using `gpt-6-luna`. A single structured choice question lists the current task IDs plus a wait option. A refused, invalid or failed answer uses a deterministic feasible-job policy. The SDK is optional because the example calls the documented HTTPS endpoint with Python's standard library.

API access and billing are separate from your ChatGPT subscription or workshop Plus code. To try paid calls, supply your own API key to your **local terminal**. Keep it out of agent.py, commits, screenshots and Codex prompts.

PowerShell:

```powershell
$secret = Read-Host "OpenAI API key" -AsSecureString
$env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new("", $secret).Password
$env:EMBASSY_DECISIONS = "1"
npm.cmd start
```

macOS/Linux, run in Bash (type `bash` first if using zsh):

```bash
read -rs -p "OpenAI API key: " OPENAI_API_KEY
echo
export OPENAI_API_KEY EMBASSY_DECISIONS=1
npm start
```

Close that terminal to end the opt-in session. To exercise only the fallback, set `EMBASSY_DECISIONS=1` in a terminal without a key. [Official Decisions reference](https://developers.openai.com/api/reference/resources/decisions/methods/create) · [API and ChatGPT billing](https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform)

## Reproduce the checks

```sh
npm ci
npm run doctor
npm run typecheck
npm run lint
npm test
npm run test:python
npm run build
npm run audit:catalogue
npm run demo
```

The game uses the existing six navigable room types. The server racks share the maintenance station. New incident definitions live in immutable `dispatch.1`. Priority, reward, mandatory status, travel, deadline and work belong to each scheduled instance. The local difficulty band comes from its spawn stage. The audit checks each definition's metadata, the nine quotas, uniqueness and reachable locations. [Catalogue audit](../apps/game/qa/catalogue-audit.json) · [Simulation rules](SIMULATION.md) · [Official contracts](API.md)
