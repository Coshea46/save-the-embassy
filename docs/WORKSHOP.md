# Run your embassy agent

1. Fork the workshop repository on GitHub. Clone your fork and open its folder in VS Code.
2. Install Node.js 24 LTS and Python 3.11 or later. In VS Code's terminal run `npm ci` from the root. Verify `node --version` and `python --version` (on macOS/Linux try `python3 --version`).
3. Open `apps/game/python/agent.py`. The starter agent always chooses the highest priority task. Its fields persist for an entire run. Return a visible task ID, or return None to wait one simulated second.
4. Run `npm run demo`. Read the terminal score and survival time. Run `npm run demo -- 7` to try another practice scenario. Reuse a seed for a fair comparison.
5. With the Codex extension in VS Code, try asking: “Edit only agent.py. Use travel time and remaining slack to pick a task. Explain a case where your strategy would wait.” Run your agent before and after. The five built-in reference strategies can be compared using `npm run benchmark -- 7,42`.

The launcher uses python on Windows and python3 on macOS/Linux. Set EMBASSY_PYTHON to your interpreter path if needed. Python tests use the python executable or can be run directly with `python3 -m unittest discover -s apps/game/python`.

## Local bridge

apps/game/bridge.mjs launches a local child process without a shell or a network listener. In a browser-based game, the local Node launcher owns this worker. If a loopback web adapter is added, bind it only to loopback, validate origin and a per-launch token, and expose fixed operations. Only the participant's local installation imports agent.py.

Each line on stdin or stdout is one UTF-8 JSON object. Send one outstanding request at a time. Every request has a positive integer id and op. Start a run with reset, then send choose requests with a schema-validated observation. Sync and async Python methods are supported. A successful response contains the same id, ok=true and result (a task ID or null). A failure contains the id, ok=false and error. Student prints go to stderr. Reset creates one fresh agent. Shutdown acknowledges, then exits. The Node host defaults to a three-second request timeout; it kills an unresponsive or malformed worker. The UI should surface the failure, pause local play, and offer a fresh run. A worker exception may have mutated agent memory. Never silently substitute a decision in an official log.

Example reset request and reply:

```json
{"id":1,"op":"reset"}
```
```json
{"id":1,"ok":true,"result":null}
```
