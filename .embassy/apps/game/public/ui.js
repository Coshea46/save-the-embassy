/* global document */
import { FloorView } from "./map.js";
const el = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="launch"]').content;
const roomNames = {
  reception: "Reception",
  office: "Offices",
  kitchen: "Kitchen",
  plant: "Server plant",
  archive: "Archives",
  sauna: "Sauna",
};
const clock = (n) =>
  [Math.floor(n / 60), n % 60].map((x) => String(x).padStart(2, "0")).join(":");
const node = (tag, text, cls) => {
  const n = document.createElement(tag);
  n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
let state,
  running = false,
  locked = false,
  selected = null,
  timer,
  bannerTimer,
  thresholds = [5, 15, 30];
const map = new FloorView(el("map"), el("mini"), (id) => {
  if (selected !== id) {
    selected = id;
    detail();
  }
});
const delay = () =>
  state?.mode === "practice" ? 1000 / Number(el("speed").value) : 220;
const terminal = () => ["closed", "finished"].includes(state?.status);
async function request(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "X-Embassy-Launch": token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) {
    const e = new Error(data.error);
    e.retryMs = data.retryMs;
    e.reason = data.reason;
    throw e;
  }
  return data;
}
function notice(message) {
  clearTimeout(bannerTimer);
  el("callout").hidden = false;
  el("callout").textContent = message;
  bannerTimer = setTimeout(() => {
    el("callout").hidden = true;
  }, 2300);
}
function detail() {
  const reports = [
    ...(state?.reports ?? []),
    ...(state?.active ? [state.active] : []),
  ];
  const task =
    reports.find((t) => t.id === selected) ?? state?.active ?? reports[0];
  selected = task?.id;
  el("detailtype").textContent = task
    ? (task.id === state.active?.id ? "On assignment" : "Incident report") +
      " / " +
      task.id.replace("report-", "#")
    : "Duty officer";
  el("detailtitle").textContent = task?.title ?? "Desk clear";
  el("detaildesc").textContent =
    task?.description ?? "The agent is waiting for the next incident.";
  const fields = task
    ? [
        ["Location", roomNames[task.room]],
        ["Reward", "+" + task.reward],
        ["Priority", task.priority + " / 10"],
        ["Travel", task.distance + " s"],
        ["Work", (task.work_left ?? task.duration) + " s"],
        ["Slack", task.slack + " s"],
        ["Due", clock(state.tick + task.time_remaining)],
        ["Class", task.mandatory ? "Mandatory" : "Optional"],
        ...(task.band ? [["Band", task.band]] : []),
      ]
    : [];
  el("facts").hidden = !fields.length;
  el("facts").replaceChildren(
    ...fields.map(([k, v]) => {
      const dl = node("dl", "");
      dl.append(node("dt", k), node("dd", v));
      return dl;
    }),
  );
  for (const row of el("queue").children)
    if (row.dataset.id)
      row.setAttribute("aria-pressed", String(row.dataset.id === selected));
}
function journal() {
  const h = el("journalMode").value === "History",
    items = h ? state.history : state.log;
  el("journal").replaceChildren(
    ...items.map((item) => {
      const row = node("div", "", "journalrow");
      row.append(
        node("span", clock(item.tick)),
        node(
          "b",
          h
            ? item.outcome +
                " · " +
                item.title +
                (item.reward ? " (+" + item.reward + ")" : "")
            : item.text,
        ),
      );
      return row;
    }),
  );
  if (!items.length)
    el("journal").append(
      node(
        "p",
        h
          ? "Completed and expired reports appear here."
          : "Run the agent to see its first decision.",
        "empty",
      ),
    );
}
function buttons() {
  const practice = state?.mode === "practice";
  el("play").textContent = running
    ? "Pause"
    : state?.tick
      ? "Resume"
      : "Run agent";
  el("play").disabled = (locked && !running) || terminal();
  el("restart").disabled = !practice || locked;
  el("settings").disabled = locked;
  el("settings").hidden = !practice;
  el("speed").hidden = !practice;
  el("fixedSpeed").hidden = practice;
  el("fixedSpeed").textContent = state?.officialSpeed
    ? state.officialSpeed + "× official"
    : "Rehearsal";
  for (const id of ["officialTab", "practiceTab", "again", "attempt"])
    el(id).disabled = locked;
}
function connection(message) {
  const n = el("network");
  n.hidden = state.mode === "practice";
  if (n.hidden) return;
  n.textContent =
    message ??
    (state.mode === "rehearsal"
      ? "Local rehearsal · Unranked"
      : state.verified
        ? "Official · Score verified"
        : state.status === "verifying"
          ? "Official · Awaiting score verification"
          : "Official · Connected at decision " + state.decisions);
  if (state.leaderboard) {
    const a = node("a", "Central leaderboard");
    a.href = state.leaderboard;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    n.append(a);
  }
}
function render(next) {
  const old = state;
  state = next;
  const practice = next.mode === "practice";
  el(practice ? "practiceTab" : "officialTab").setAttribute(
    "aria-current",
    "page",
  );
  el(practice ? "officialTab" : "practiceTab").removeAttribute("aria-current");
  el("modeTag").textContent = practice
    ? "Practice shift"
    : next.mode === "rehearsal"
      ? "Local rehearsal"
      : "Official shift";
  el("seedTag").textContent = practice
    ? "Seed " + next.seed
    : next.verified
      ? "Verified"
      : "Server protocol";
  for (const [id, val, len] of [
    ["score", next.metrics.score, 4],
    ["completed", next.metrics.completed, 2],
    ["open", next.reports.length + Number(!!next.active), 2],
  ])
    el(id).textContent = String(val).padStart(len, "0");
  el("clock").textContent = clock(next.tick);
  const queue = [...(next.active ? [next.active] : []), ...next.reports];
  el("queueCount").textContent = queue.length + " open";
  el("queue").replaceChildren(
    ...queue.map((t) => {
      const b = node("button", "", "report"),
        icon = document.createElement("img");
      icon.src = "/paper.png";
      icon.alt = "";
      b.dataset.id = t.id;
      b.append(
        icon,
        node("span", t.title),
        node(
          "span",
          t.id === next.active?.id
            ? "In progress"
            : (t.mandatory ? "Mandatory · " : "") + roomNames[t.room],
          "roomtag",
        ),
      );
      b.onclick = () => {
        selected = t.id;
        detail();
      };
      return b;
    }),
  );
  if (!queue.length)
    el("queue").append(node("p", "No outstanding reports.", "empty"));
  detail();
  journal();
  map.update(next, delay());
  connection();
  if (old && next.tick > old.tick && next.mode === old.mode) {
    const ids = new Set(
      [...old.reports, old.active].filter(Boolean).map((t) => t.id),
    );
    const incoming = next.reports.find((t) => !ids.has(t.id));
    if (incoming) notice("Incoming · " + incoming.title);
    else if (next.metrics.completed > old.metrics.completed)
      notice(
        "Filed · " + next.history.find((h) => h.outcome === "Completed")?.title,
      );
  } else {
    clearTimeout(bannerTimer);
    el("callout").hidden = true;
  }
  el("terminal").hidden = !terminal();
  el("attempt").hidden = !next.verified;
  if (terminal()) {
    running = false;
    el("terminalTitle").textContent =
      next.status === "closed" ? "Embassy closed" : "Shift complete";
    el("terminalText").textContent =
      (next.status === "closed"
        ? "A mandatory report expired. "
        : "The shift reached its scheduled end. ") +
      next.metrics.score +
      " points · " +
      next.metrics.completed +
      " completed at " +
      clock(next.tick) +
      ".";
    el("again").textContent = practice ? "Restart shift" : "Open practice";
  }
  buttons();
}
function fail(error, retryAction) {
  running = false;
  clearTimeout(timer);
  const n = el("errors");
  n.hidden = false;
  n.textContent = error.message + " ";
  if (state) {
    const retry = node("button", "Retry");
    retry.onclick = () => {
      n.hidden = true;
      if (retryAction) retryAction();
      else run();
    };
    const reload = node("button", "Reload agent");
    reload.onclick = () => command("/agent", {});
    n.append(retry, reload);
    if (state.mode !== "practice")
      connection(
        (error.reason === "connection"
          ? "Connection interrupted"
          : "Run paused") +
          " · Last accepted score " +
          state.metrics.score,
      );
  }
  buttons();
}
function stop() {
  running = false;
  clearTimeout(timer);
  buttons();
}
async function step() {
  if (!running || locked) return;
  locked = true;
  let wait = state.mode === "official" ? 0 : delay();
  try {
    render(await request("/step", { revision: state.revision }));
  } catch (e) {
    if (e.retryMs > 0) {
      wait = e.retryMs;
      const seconds = Math.ceil(wait / 100) / 10 + " s";
      connection(
        e.reason === "simulation_pacing"
          ? "Official " +
              state.officialSpeed +
              "× · Next simulation update in " +
              seconds
          : "Server request limit · Retrying in " + seconds,
      );
    } else fail(e);
  } finally {
    locked = false;
    buttons();
  }
  if (running && !terminal()) timer = setTimeout(step, wait);
}
function run() {
  if (!state || terminal()) return;
  el("errors").hidden = true;
  running = true;
  buttons();
  step();
}
async function command(path, body) {
  if (locked) return;
  stop();
  locked = true;
  buttons();
  el("errors").hidden = true;
  try {
    selected = null;
    render(await request(path, body));
  } catch (e) {
    fail(e, () => command(path, body));
  } finally {
    locked = false;
    buttons();
  }
}
el("play").onclick = () => (running ? stop() : run());
el("restart").onclick = () =>
  command("/practice", { seed: state.seed, thresholds });
el("attempt").onclick = () => command("/attempt", {});
el("again").onclick = () =>
  command("/practice", { seed: state.seed ?? 42, thresholds });
el("camera").onclick = () => {
  map.follow = !map.follow;
  el("camera").textContent = map.follow ? "Whole floor" : "Follow agent";
};
el("settings").onclick = () => {
  stop();
  el("seed").value = state.seed;
  el("config").showModal();
};
el("configForm").onsubmit = (e) => {
  e.preventDefault();
  const values = ["critical", "very", "urgent"].map((id) =>
    Number(el(id).value),
  );
  if (values[1] <= values[0] || values[2] <= values[1]) {
    el("urgent").setCustomValidity("Use three increasing thresholds.");
    el("urgent").reportValidity();
    return;
  }
  thresholds = values;
  el("config").close();
  command("/practice", {
    seed: el("seed").value === "" ? null : Number(el("seed").value),
    thresholds,
  });
};
el("configForm").oninput = () => el("urgent").setCustomValidity("");
el("practiceTab").onclick = () => {
  if (state?.mode !== "practice")
    command("/practice", { seed: 42, thresholds });
};
function joinFields() {
  const mode = el("connection").value;
  for (const id of ["name", "workshop", "code", "credentials"]) {
    const show =
      id === "credentials"
        ? mode === "import"
        : id === "name"
          ? mode !== "import"
          : mode === "official";
    el(id).required = show;
    el(id).parentElement.hidden = !show;
  }
  el("joinHelp").textContent = {
    import:
      "On the organiser’s website, join and choose Copy game credentials. Paste them below to start or resume.",
    rehearsal:
      "Exercise the official protocol locally. Rehearsal scores are unranked.",
    official:
      "Use your organiser’s workshop ID and join code. Reconnecting resumes the registered run.",
  }[mode];
}
el("officialTab").onclick = () => {
  stop();
  el("connection").options[0].disabled = !state.connected;
  el("connection").value = state.connected ? "official" : "import";
  joinFields();
  el("join").showModal();
};
el("connection").onchange = joinFields;
el("joinForm").onsubmit = (e) => {
  e.preventDefault();
  el("join").close();
  const credentials = el("credentials").value;
  el("credentials").value = "";
  command("/connect", {
    credentials,
    mode: el("connection").value,
    workshop: el("workshop").value.trim(),
    code:
      el("connection").value === "rehearsal"
        ? "rehearsal"
        : el("code").value.trim(),
    name: el("name").value.trim(),
  });
};
for (const b of document.querySelectorAll(".close"))
  b.onclick = () => b.closest("dialog").close();
el("journalMode").onchange = journal;
request("/state").then(render).catch(fail);
