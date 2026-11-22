"""Exercise the participant commands and edit loop in a disposable copy of HEAD."""
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
from urllib.request import Request, urlopen
from zipfile import ZipFile


def rehearse(root):
    npm = [shutil.which("npm.cmd" if os.name == "nt" else "npm"), "--prefix", ".embassy"]
    env = {**os.environ, "EMBASSY_PORT": "0", "EMBASSY_DECISIONS": "0"}
    subprocess.run([*npm, "ci"], cwd=root, check=True)
    agent = root / "agent.py"
    starter = agent.read_bytes()
    agent.write_text("async def choose_next_task(obs): return None\n", encoding="utf-8")
    log = root / "launch.log"
    with log.open("wb") as output:
        process = subprocess.Popen([*npm, "start"], cwd=root, env=env, stdout=output,
                                   stderr=subprocess.STDOUT, start_new_session=os.name != "nt")
    try:
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline and process.poll() is None:
            match = re.search(r"http://127\.0\.0\.1:\d+", log.read_text(errors="replace"))
            if match:
                break
            time.sleep(0.2)
        else:
            raise RuntimeError(log.read_text(errors="replace"))
        origin = match.group()
        with urlopen(origin, timeout=10) as response:
            token = re.search(r'name="launch" content="([^"]+)"', response.read().decode())[1]

        def post(path, body):
            request = Request(origin + path, data=json.dumps(body).encode(), headers={
                "x-embassy-launch": token, "Origin": origin, "Content-Type": "application/json"})
            with urlopen(request, timeout=10) as response:
                return json.load(response)

        def first_decision():
            frame = post("/practice", {"seed": 7})
            return post("/step", {"revision": frame["revision"]})["log"][0]["text"]

        assert first_decision() == "Wait one tick"
        agent.write_bytes(starter)
        assert first_decision().startswith("Selected ")
    finally:
        if process.poll() is None:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], check=True)
            else:
                os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=15)

    agent.write_text("from pathlib import Path\n"
                     "def choose_next_task(obs):\n"
                     "    Path(__file__).with_suffix('.visited').touch()\n"
                     "    return None\n", encoding="utf-8")
    subprocess.run([*npm, "run", "agent:benchmark", "--", "7"], cwd=root, env=env,
                   timeout=120, check=True)
    assert agent.with_suffix(".visited").exists()


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[2]
    files = subprocess.check_output(["git", "archive", "--format=zip", "HEAD"], cwd=repo)
    with tempfile.TemporaryDirectory(prefix="Embassy student ") as directory:
        root = Path(directory)
        with ZipFile(io.BytesIO(files)) as archive:
            archive.extractall(root)
        assert list(root.rglob("agent.py")) == [root / "agent.py"]
        assert sorted(p.name for p in root.iterdir() if not p.name.startswith(".")) == ["README.md", "agent.py"]
        rehearse(root)
