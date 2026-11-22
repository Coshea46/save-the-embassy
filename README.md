# Save the Finnish Embassy

Your officer has six simulated minutes to keep the embassy open. Try the starter strategy, improve it with Codex and enter it in the workshop competition.

## 1. Get the game running

**Install the tools.** Open the instructions for your laptop. A terminal is a window where you paste commands and press **Enter** to run them. Wait for each block to finish.

<details>
<summary>Windows 10 or 11</summary>

Open **Start**, type **PowerShell** and open **Windows PowerShell**. Paste these commands. Approve the installation prompts. If `winget` is missing, update **App Installer** in the Microsoft Store and reopen PowerShell.

```powershell
winget install --id Git.Git -e --source winget
winget install --id Python.Python.3.12 -e --source winget
winget install --id OpenJS.NodeJS.LTS -e --source winget
winget install --id Microsoft.VisualStudioCode -e --source winget
```

Once all four finish, close PowerShell. If VS Code was already open, quit it too.

</details>

<details>
<summary>macOS</summary>

Press **Command + Space**, type **Terminal** and press **Return**. If you already use Homebrew, skip the first block. Otherwise install it below. Enter your Mac password if asked (typing stays invisible), then run the commands printed under **Next steps**.

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

In the same Terminal, install the workshop tools. If VS Code was already open, quit it when the commands finish.

```sh
brew install git python node
test -d "/Applications/Visual Studio Code.app" || brew install --cask visual-studio-code
```

</details>

<details>
<summary>Linux · Ubuntu, Debian or Fedora</summary>

Open **Terminal** from your apps. Run the block for your distribution, then the shared Node.js block below. Enter your laptop password when asked.

**Ubuntu 24.04 or newer / Debian 12 or newer**

```sh
sudo apt update
sudo apt install -y git python3 curl ca-certificates
curl -fL "https://update.code.visualstudio.com/latest/linux-deb-$(dpkg --print-architecture | sed 's/^amd64$/x64/')/stable" -o /tmp/embassy-code.deb
sudo apt install -y /tmp/embassy-code.deb
```

**Fedora**

```sh
sudo dnf install -y git python3
command -v curl || sudo dnf install -y curl
case "$(uname -m)" in x86_64) code_arch=x64 ;; aarch64) code_arch=arm64 ;; esac
curl -fL "https://update.code.visualstudio.com/latest/linux-rpm-${code_arch}/stable" -o /tmp/embassy-code.rpm
sudo dnf install -y /tmp/embassy-code.rpm
```

**All three distributions** · Install Node.js in the same terminal.

```sh
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 24
nvm alias default 24
```

If VS Code was already open, quit it before continuing.

</details>

**In your browser, make your own copy (a fork).**

1. Sign in to GitHub and open [Save the Embassy](https://github.com/Coshea46/save-the-embassy).
2. Click **Fork** at the top right. Under **Owner**, select your GitHub account. Keep the name `save-the-embassy` and click **Create fork**.
3. Your username should now appear above the files. Click the green **Code** button, choose **HTTPS** and click the copy icon beside the address.

**In VS Code, download your fork and install Codex.**

1. Open **Visual Studio Code** from your apps. Press **F1**, type `Git: Clone` and select it. Paste the address you copied and press **Enter**.
2. Choose a folder such as **Documents**. When the download finishes, click **Open**. If asked whether you trust your fork, select **Yes, I trust the authors**. You should see `agent.py` in the left-hand file list.
3. Click **Extensions** in the left sidebar. Search for `@id:openai.chatgpt`, select **Codex** by **OpenAI** and click **Install**. Open **Codex** in the sidebar and select **Sign in with ChatGPT**.

**In VS Code, start the game.** Choose **Terminal → New Terminal**. Paste the block for your laptop. The first line installs the game's dependencies and the second starts the game.

<details>
<summary>Windows · PowerShell</summary>

```powershell
npm.cmd --prefix .embassy ci
npm.cmd --prefix .embassy start
```

</details>

<details>
<summary>macOS or Linux · Terminal</summary>

```sh
npm --prefix .embassy ci
npm --prefix .embassy start
```

</details>

**In your browser, play a practice shift.** When the terminal says **Embassy Dispatch is ready**, leave it open. On the same laptop, open [http://127.0.0.1:4173](http://127.0.0.1:4173) and click **Run agent**. When the shift clock moves and the officer picks a task, setup is complete. Note your score when the shift ends.

![Practice shift showing the officer on the embassy floor, the shift clock and the score](.embassy/apps/game/qa/practice.jpg)

## 2. Build your agent

In VS Code, open [agent.py](agent.py) at the top of the file list. It's the only file you need to change. You can describe your strategy to Codex in plain English, without writing Python yourself.

The starter already picks the highest-priority task. Its `choose_next_task` function receives the available tasks, including their priorities, deadlines, rewards and travel distances. It returns the ID of the task the officer should tackle next.

**Paste this into Codex:**

> Improve my agent so it considers task deadlines, rewards and travel distances. Only modify agent.py.

Review the change and save `agent.py` (**Ctrl+S** or **Command+S** on Mac). Back in the game, click **Restart → Run agent**. You’ll get the same practice shift, so you can compare your new score with the starter’s.

## 3. Join the leaderboard

Only official competition attempts count. Local practice runs do not appear on the leaderboard. You can register early. Wait for the organiser to open the competition before selecting **Join or resume**.

1. Open the organiser’s invitation link from WhatsApp or the presentation screen on the laptop running the game.
2. Enter your **Player name**.
3. Select **Join competition**.
4. Select **Copy game credentials**. Keep these private.
5. Return to the local game at [http://127.0.0.1:4173](http://127.0.0.1:4173).
6. Open **Competition**. Under **Connection**, choose **Joined on the website**.
7. Paste into **Game credentials**.
8. Select **Join or resume**, then **Run agent**.
9. When the game shows **Score verified**, select **Central leaderboard** to see your verified score beside your player name.

If the organiser allows another attempt, save your improved `agent.py`. On the finished official shift, select **Start another official attempt → Run agent**. The leaderboard keeps your best eligible score.

---

**Further help** · [Setup troubleshooting](.embassy/docs/WORKSHOP.md#setup-troubleshooting) · [Strategy ideas](.embassy/docs/WORKSHOP.md#make-one-decision) · [Benchmark your agent](.embassy/docs/WORKSHOP.md#benchmark-your-agent) · [Optional Decisions API](.embassy/docs/WORKSHOP.md#optional-openai-decisions-strategy) · [Developer guide](.embassy/docs/ARCHITECTURE.md) · [Organiser guide](.embassy/docs/PLATFORM.md)
