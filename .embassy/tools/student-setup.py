"""Run the participant README's installer blocks on the matching native CI runner."""
import os
from pathlib import Path
import re
import subprocess
import sys

readme = Path("README.md").read_text(encoding="utf-8")


def blocks(summary):
    section = readme.split(f"<summary>{summary}</summary>", 1)[1].split("</details>", 1)[0]
    return re.findall(r"^```(?:sh|powershell)\n(.*?)\n```$", section, re.M | re.S)


if sys.platform == "win32":
    install, = blocks("Windows 10 or 11")
    for command in install.splitlines():
        result = subprocess.run(["powershell", "-NoProfile", "-Command", command + "; exit $LASTEXITCODE"])
        # WinGet reports an existing up-to-date package on pre-provisioned runners.
        if result.returncode & 0xffffffff != 0x8a15002b:
            result.check_returncode()
elif sys.platform == "darwin":
    bootstrap, install = blocks("macOS")
    subprocess.run(["bash", "-ec", "command -v brew >/dev/null || " + bootstrap + "\n" + install], check=True)
else:
    debian, fedora, node = blocks("Linux · Ubuntu, Debian or Fedora")
    install = {"Ubuntu or Debian": debian, "Fedora": fedora}[os.environ["SECTION"]]
    subprocess.run(["bash", "-ec", "\n".join([
        install, node, "code --version", "npm --prefix .embassy ci",
        "npm --prefix .embassy run doctor", "npm --prefix .embassy run build",
        "cd .embassy", "node --test tests/game-launcher.test.mjs",
    ])], check=True)
