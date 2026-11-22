"""Run the documented distro-specific setup and the real launcher in Linux CI."""
import os
from pathlib import Path
import re
import subprocess

readme = Path("README.md").read_text()


def shell_block(heading):
    section = readme.split("### " + heading + "\n", 1)[1].split("\n##", 1)[0]
    return re.search(r"```sh\n(.+?)\n```", section, re.S).group(1)


commands = [
    "set -e",
    shell_block(os.environ["SECTION"]),
    shell_block("Node.js on Linux"),
    "npm --prefix .embassy ci",
    "npm --prefix .embassy run doctor",
    "npm --prefix .embassy run build",
    "cd .embassy",
    "node --test tests/game-launcher.test.mjs",
]
subprocess.run(["bash", "-c", "\n".join(commands)], check=True)
