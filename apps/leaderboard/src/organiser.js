/* global location, confirm, prompt */
export async function organiser({
  root,
  by,
  esc,
  api,
  handler,
  feedback,
  notice,
}) {
  let selected = "",
    workshops = [];
  function login() {
    root.innerHTML = `<section class="narrow"><p class="eyebrow">Tournament control</p><h1>Organiser desk</h1><form id="login"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button></form>${notice}</section>`;
    handler(by("login"), async (d) => {
      await api("/admin/login", d);
      await desk();
    });
  }
  function settingsFields() {
    return '<label>Workshop title<input name="title" maxlength="100" required></label><label>Join code<input name="join_code" minlength="6" maxlength="40" required></label><label>Prize label<input name="prize" value="GRAND PRIZE: A 4-PACK OF WHITE MONSTER"></label><label>Attempts per player<input name="attempt_limit" type="number" min="1" max="20" value="1" required></label><label>Entry window (minutes)<input name="entry_minutes" type="number" min="1" max="1440" value="30" required></label>';
  }
  async function desk() {
    workshops = await api("/admin/workshops");
    if (!selected) selected = workshops[0]?.id ?? "";
    root.innerHTML = `<div class="bar"><p class="eyebrow">Tournament control</p><button id="logout" class="secondary">Sign out</button></div><h1>Organiser desk</h1>${notice}
    <details ${workshops.length ? "" : "open"}><summary>Create a workshop</summary><form id="new" class="gridform">${settingsFields()}<button>Create workshop</button></form></details>
    <label>Workshop<select id="workshop">${workshops.map((w) => `<option value="${esc(w.id)}" ${w.id === selected ? "selected" : ""}>${esc(w.title)}</option>`).join("")}</select></label><div id="manage"></div>`;
    by("logout").onclick = async () => {
      try {
        await api("/admin/logout", {});
        login();
      } catch (e) {
        feedback(e);
      }
    };
    handler(by("new"), async (d) => {
      const w = await api("/admin/workshops", {
        ...d,
        attempt_limit: Number(d.attempt_limit),
        entry_minutes: Number(d.entry_minutes),
      });
      selected = w.workshop_id;
      await desk();
      feedback("Workshop created. Share the join code or invitation link.");
    });
    by("workshop").onchange = async (e) => {
      selected = e.target.value;
      await display().catch(feedback);
    };
    if (selected) await display();
  }
  async function display() {
    const id = selected,
      d = await api("/admin/workshops/" + id);
    if (id !== selected || !by("manage")) return;
    const w = workshops.find((x) => x.id === id),
      b = d.board;
    const endpoint = "/admin/workshops/" + id;
    by("manage").innerHTML =
      `<section><div class="section-head"><h2>${esc(b.title)}</h2><span class="eyebrow">${esc(b.phase)}</span></div>
    <div class="actions"><a href="/board/${id}">Standings ↗</a><a href="/projector/${id}">Projector ↗</a><a href="${endpoint}/export">Export CSV ↓</a><button id="invite" class="secondary">Invitation link</button></div>
    <div class="actions"><button id="registration" ${b.phase === "ended" ? "disabled" : ""}>${b.registration ? "Close" : "Open"} registration</button>
    <button id="round" ${b.phase === "ended" ? "disabled" : ""}>${b.phase === "lobby" ? "Start competition" : "End entry window"}</button></div>
    <details><summary>Workshop settings</summary><form id="edit" class="gridform">${settingsFields()}<button>Save settings</button></form></details></section>
    <section><div class="section-head"><h2>Participants (${d.participants.length})</h2><button id="refresh" class="secondary">Refresh</button></div><ul class="manage-list">${d.participants.map((p) => `<li>${esc(p.display_name)}<button class="secondary" data-rename="${p.participant_id}">Rename</button></li>`).join("") || "<li>No participants yet.</li>"}</ul></section>
    <section><h2>Run monitor</h2><div class="scroll"><table><thead><tr><th>Agent</th><th>Score</th><th>State</th><th>Decisions</th><th>Controls</th></tr></thead><tbody>${d.runs.map((r) => `<tr><td>${esc(r.display_name)}</td><td>${r.score}</td><td>${esc(r.exclusion ?? (r.finished_at ? "finalised" : r.status))}</td><td><button class="secondary" data-history="${r.id}">${r.next_sequence} · inspect</button></td><td><button class="secondary" data-dq="${r.id}">Disqualify</button> <button class="secondary" data-reset="${r.id}">Reset</button></td></tr>`).join("")}</tbody></table></div><pre id="history"></pre></section>`;
    const form = by("edit");
    for (const field of ["title", "prize", "attempt_limit", "entry_minutes"])
      form.elements[field].value = w[field];
    form.elements.join_code.required = false;
    form.elements.join_code.placeholder = "Leave blank to keep current code";
    if (b.phase !== "lobby") {
      form.elements.entry_minutes.disabled = true;
      form.elements.attempt_limit.disabled = true;
    }
    handler(form, async (data) => {
      if (!data.join_code) delete data.join_code;
      for (const f of ["attempt_limit", "entry_minutes"])
        if (f in data) data[f] = Number(data[f]);
      await api(endpoint, { action: "configure", ...data });
      await desk();
      feedback("Settings saved.");
    });
    const act = async (data) => {
      await api(endpoint, data);
      await desk();
    };
    by("manage").onclick = async (event) => {
      const el = event.target.closest("button");
      if (!el) return;
      try {
        if (el.id === "registration")
          await act({ action: "registration", open: !b.registration });
        if (el.id === "refresh") await display();
        if (
          el.id === "round" &&
          confirm(
            b.phase === "lobby"
              ? "Start the entry clock?"
              : "Close entry and allow active runs their full grace period?",
          )
        )
          await act({ action: b.phase === "lobby" ? "start" : "end" });
        if (el.id === "invite") {
          const code = prompt("Enter the current join code");
          if (code) {
            const match = await api("/workshops/resolve", { join_code: code });
            if (match.workshop_id !== id)
              throw new Error("Code belongs to a different workshop");
            feedback(
              location.origin + "/join#code=" + encodeURIComponent(code),
            );
          }
        }
        if (el.dataset.rename) {
          const display_name = prompt("New player name");
          if (display_name)
            await act({
              action: "rename",
              participant_id: el.dataset.rename,
              display_name,
            });
        }
        if (el.dataset.history)
          by("history").textContent = JSON.stringify(
            await api("/admin/runs/" + el.dataset.history + "/decisions"),
            null,
            2,
          );
        const run_id = el.dataset.dq ?? el.dataset.reset;
        if (run_id) {
          const reason = prompt(
            el.dataset.dq
              ? "Disqualify this run. Record the reason:"
              : "Exclude this run and free its attempt slot. Record the reason:",
          );
          if (reason)
            await act({
              action: el.dataset.dq ? "disqualify" : "reset",
              run_id,
              reason,
            });
        }
      } catch (e) {
        feedback(e);
      }
    };
  }
  try {
    await desk();
  } catch (e) {
    login();
    if (e.status !== 401) feedback(e);
  }
}
