/* global document, location, history, window */
import "./style.css";
import { createClient } from "@supabase/supabase-js";
import { watchBoard, subscribeStandings } from "./live.js";
import { drawEmbassy } from "./art.js";
const root = document.querySelector("#app"),
  by = (id) => document.getElementById(id);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
async function api(path, body, access) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(access ? { Authorization: "Bearer " + access } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const data = await r.json();
  if (!r.ok)
    throw Object.assign(new Error(data.error ?? "Request failed"), {
      status: r.status,
    });
  return data;
}
const formData = (form) => Object.fromEntries(new FormData(form));
const feedback = (e) => {
  by("notice").textContent = e.message ?? String(e);
};
const notice = '<p id="notice" role="status"></p>';
function handler(form, fn) {
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await fn(formData(form));
    } catch (err) {
      feedback(err);
    } finally {
      button.disabled = false;
    }
  };
}
function art() {
  drawEmbassy(by("scene"));
}
const canvas = '<canvas id="scene" aria-hidden="true"></canvas>';
const [page, id] = location.pathname.split("/").slice(1);
const ticks = (v) => Math.floor(v / 60) + ":" + String(v % 60).padStart(2, "0");
function join() {
  const params = new URLSearchParams(location.hash.slice(1));
  const session = JSON.parse(localStorage.getItem("embassy.player") ?? "null");
  root.innerHTML = `<section class="poster"><div><p class="eyebrow">Finnish crisis command</p><h1>Save the<br>Embassy<span>.</span></h1><p>Build a Python agent. Keep the embassy open.</p></div>${canvas}</section>
  <section class="narrow"><h2>Join the workshop</h2><form id="entry"><label>Player name<input name="display_name" maxlength="32" required autocomplete="nickname" value="${esc(session?.name)}" ${session ? "readonly" : ""}></label><label>Workshop code<input name="join_code" required maxlength="40" value="${esc(params.get("code"))}" autocomplete="off"></label><button>Join competition →</button></form>${notice}<div id="saved"></div></section>`;
  art();
  if (params.has("code")) history.replaceState(null, "", location.pathname);
  function saved(s) {
    if (s?.workshop) {
      by("saved").innerHTML =
        `<p>Signed in as <strong>${esc(s.name)}</strong></p><div class="actions"><a class="button" href="/board/${esc(s.workshop)}">Live standings</a><button class="secondary" id="copy">Copy game credentials</button></div>`;
      by("copy").onclick = async () => {
        try {
          await navigator.clipboard.writeText(
            JSON.stringify({
              api_url: location.origin,
              workshop_id: s.workshop,
              participant_id: s.participant_id,
              access_token: s.access_token,
            }),
          );
          feedback("Credentials copied. Keep them private.");
        } catch {
          feedback(
            "Clipboard unavailable. Use participant registration in the local game.",
          );
        }
      };
    }
    if (s) {
      const reset = document.createElement("button");
      reset.className = "secondary";
      reset.textContent = "Use a different player";
      reset.onclick = () => {
        if (
          window.confirm("Forget the saved participant token on this browser?")
        ) {
          localStorage.removeItem("embassy.player");
          join();
        }
      };
      by("saved").append(reset);
    }
  }
  saved(session);
  handler(by("entry"), async (d) => {
    const { workshop_id } = await api("/workshops/resolve", {
      join_code: d.join_code,
    });
    let s = JSON.parse(localStorage.getItem("embassy.player") ?? "null");
    if (!s) {
      s = {
        ...(await api("/participants", { display_name: d.display_name })),
        name: d.display_name,
      };
      localStorage.setItem("embassy.player", JSON.stringify(s));
    }
    try {
      await api(
        "/workshops/" + workshop_id + "/join",
        { join_code: d.join_code },
        s.access_token,
      );
    } catch (e) {
      if (!s.workshop && [401, 409].includes(e.status)) {
        localStorage.removeItem("embassy.player");
        join();
      }
      throw e;
    }
    s.workshop = workshop_id;
    localStorage.setItem("embassy.player", JSON.stringify(s));
    join();
    feedback("Joined. Copy your credentials into the local game launcher.");
  });
}
async function board() {
  const projector = page === "projector";
  document.body.classList.toggle("projector", projector);
  root.innerHTML = `<div class="bar"><span class="eyebrow">Tournament broadcast</span><div>${projector ? '<button class="secondary" id="full">Fullscreen</button>' : '<a class="secondary" href="/projector/' + esc(id) + '">Projector view ↗</a>'}</div></div>
    <section class="poster boardposter"><div><p class="eyebrow" id="phase">Connecting</p><h1 id="title">Live standings</h1><p id="prize"></p></div>${canvas}</section><div class="stats" id="stats"></div>
    <div class="columns"><section><div class="section-head"><h2>Standings</h2><small id="sync">Connecting</small></div><div id="ranks"></div></section>
    <aside><h2>Dispatch wire</h2><p class="announce" id="leader" role="status">Waiting for first dispatch</p><ul id="feed"></ul></aside></div>${notice}`;
  art();
  if (projector)
    by("full").onclick = () =>
      document.fullscreenElement
        ? document.exitFullscreen()
        : document.documentElement.requestFullscreen().catch(feedback);
  let previous = new Map(),
    leader = "",
    state = "CONNECTING",
    ends,
    phase,
    serverOffset = 0,
    isFinal = false,
    lastRead = 0;
  function clock() {
    const remaining = ends
      ? Math.max(0, Math.ceil((ends - Date.now() - serverOffset) / 1000))
      : 0;
    by("phase").textContent = isFinal
      ? "Final results"
      : phase === "lobby"
        ? "Registration lobby"
        : phase === "running" && remaining
          ? "Entry closes in " + ticks(remaining)
          : "Entry closed · remaining runs finishing";
    by("sync").textContent =
      Date.now() - lastRead > 18000
        ? "Reconnecting…"
        : state === "SUBSCRIBED"
          ? "● Live"
          : "Snapshot updates";
  }
  function paint(b) {
    lastRead = Date.now();
    phase = b.phase;
    ends = b.entry_until && Date.parse(b.entry_until);
    serverOffset = Date.parse(b.server_time) - Date.now();
    isFinal = b.final;
    clock();
    document.title = b.title + " · Embassy Dispatch";
    by("title").textContent = b.title;
    by("prize").textContent = b.prize;
    by("notice").textContent = "";
    by("stats").innerHTML = [
      ["Players", b.players],
      ["Active agents", b.active],
      ["Closed embassies", b.closed],
    ]
      .map(
        ([l, v]) =>
          `<div><small>${esc(l)}</small><strong>${esc(v)}</strong></div>`,
      )
      .join("");
    const top = b.entries
      .filter((e) => e.rank === 1)
      .map((e) => e.display_name)
      .join(" + ");
    if (projector && b.final && top) {
      by("phase").textContent = b.title + " · Final results";
      by("title").textContent = top;
      by("prize").textContent =
        "Champion" +
        (b.entries.filter((e) => e.rank === 1).length > 1 ? "s" : "") +
        " · " +
        b.entries[0].score +
        " points · " +
        b.prize;
      by("title").closest(".poster").classList.add("winner");
    } else by("title").closest(".poster").classList.remove("winner");
    if (b.final)
      by("leader").textContent = top
        ? "Winner" +
          (b.entries.filter((e) => e.rank === 1).length > 1 ? "s" : "") +
          " · " +
          top
        : "Round closed · no eligible result";
    else if (top !== leader)
      by("leader").textContent =
        (leader ? "New leader · " : "Leading · ") + top;
    if (!top && !b.final)
      by("leader").textContent = "Waiting for first dispatch";
    leader = top;
    const rows = projector ? b.entries.slice(0, 8) : b.entries;
    by("ranks").innerHTML = rows.length
      ? `<table><thead><tr><th>Rank</th><th>Agent</th><th>Score</th><th>Tasks</th><th>Survival</th></tr></thead><tbody>${rows
          .map((e) => {
            const prev = previous.get(e.display_name),
              delta = prev ? prev.rank - e.rank : 0;
            const marker =
              delta > 0 ? " ↑" + delta : delta < 0 ? " ↓" + -delta : "";
            const change =
              prev && prev.score < e.score ? " +" + (e.score - prev.score) : "";
            return `<tr class="${e.rank === 1 ? "first" : ""}"><td>${e.rank}<small>${marker}</small></td><td>${esc(e.display_name)}<small>${e.disconnected && e.status === "playing" ? "Reconnecting" : e.status === "closed" ? "Embassy closed" : e.finalised ? "Final" : e.status === "finished" ? "Awaiting verification" : "Active"}</small></td><td class="score">${e.score}<small>${change}</small></td><td>${e.completed}</td><td>${ticks(e.survival_ticks)}</td></tr>`;
          })
          .join("")}</tbody></table>`
      : '<p class="empty">The first official run will appear here.</p>';
    previous = new Map(b.entries.map((e) => [e.display_name, e]));
    const events = [
      ...b.closures.map((e) => ({ ...e, title: "Embassy closed" })),
      ...b.activity,
    ]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, 6);
    by("feed").innerHTML = events.length
      ? events
          .map(
            (e) =>
              `<li><strong>${esc(e.display_name)}</strong><span>${esc(e.title)}</span></li>`,
          )
          .join("")
      : "<li>Awaiting field reports.</li>";
  }
  const config = await api("/config");
  const client =
    config.url && config.key
      ? createClient(config.url, config.key, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        })
      : null;
  const stop = watchBoard({
    read: () => api("/workshops/" + id + "/display"),
    paint,
    onError: feedback,
    setState: (s) => {
      state = s;
    },
    subscribe: (update, onState) => {
      if (!client) return () => {};
      return subscribeStandings(client, id, update, onState);
    },
  });
  const timer = setInterval(() => {
    if (lastRead) clock();
  }, 1000);
  window.addEventListener(
    "pagehide",
    () => {
      clearInterval(timer);
      stop();
    },
    { once: true },
  );
}
if (page === "organiser")
  import("./organiser.js")
    .then((m) => m.organiser({ root, by, esc, api, handler, feedback, notice }))
    .catch(feedback);
else if ((page === "board" || page === "projector") && id)
  board().catch(feedback);
else join();
