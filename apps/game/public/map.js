/* global Image, requestAnimationFrame, matchMedia */
const image = (name) => {
  const img = new Image();
  img.src = "/" + name + ".png";
  return img;
};
const floor = image("floor"),
  paper = image("paper"),
  ranger = image("ranger");
const TILE = 24,
  LEFT = 32,
  TOP = 25;
const count = { normal: 0, urgent: 1, very_urgent: 2, critical: 3 };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const same = (a, b) => a?.x === b?.x && a?.y === b?.y;

export class FloorView {
  constructor(map, mini, inspect) {
    this.map = map;
    this.mini = mini;
    this.inspect = inspect;
    this.since = new Map();
    this.targets = new Map();
    this.direction = 0;
    this.follow = false;
    for (const canvas of [map, mini]) {
      const pick = (e) => {
        const r = canvas.getBoundingClientRect();
        const x = ((e.clientX - r.left) * canvas.width) / r.width,
          y = ((e.clientY - r.top) * canvas.height) / r.height;
        const target = [...(this.targets.get(canvas) ?? [])]
          .reverse()
          .find(
            (t) => x >= t.x && x <= t.x + t.w && y >= t.y - 5 && y <= t.y + t.h,
          );
        if (target) this.inspect(target.id);
      };
      canvas.addEventListener("pointermove", pick);
      canvas.addEventListener("click", pick);
    }
    const draw = (now) => {
      if (this.state && floor.complete && ranger.complete && paper.complete) {
        this.paint(this.map, false, now);
        this.paint(this.mini, true, now);
      }
      requestAnimationFrame(draw);
    };
    requestAnimationFrame(draw);
  }
  update(next, ms) {
    const last = this.state,
      p = next.position;
    const t = performance.now(),
      consecutive =
        last?.mode === "practice" &&
        next.mode === "practice" &&
        next.tick === last.tick + 1;
    if (!last || next.tick <= last.tick || next.mode !== last.mode)
      this.since.clear();
    this.from = consecutive ? last.position : p;
    this.walk = consecutive && !same(this.from, p);
    if (this.walk)
      this.direction =
        p.x > this.from.x
          ? 3
          : p.x < this.from.x
            ? 1
            : p.y < this.from.y
              ? 2
              : 0;
    this.start = t;
    this.duration = Math.min(700, ms);
    if (consecutive && next.metrics.completed > last.metrics.completed)
      this.celebrate = t + 600;
    this.state = next;
    const tasks = [...next.reports, ...(next.active ? [next.active] : [])];
    this.groups = new Map();
    for (const task of tasks) {
      if (!this.since.has(task.id)) this.since.set(task.id, t);
      const key = task.position.x + "," + task.position.y;
      if (!this.groups.has(key)) this.groups.set(key, []);
      this.groups.get(key).push(task);
    }
    this.miniBase ??= this.minimap(next.floor.tiles);
  }
  minimap(tiles) {
    const c = this.mini.ownerDocument.createElement("canvas");
    c.width = 190;
    c.height = 110;
    const ctx = c.getContext("2d");
    for (const [y, row] of tiles.entries())
      for (const [x, ch] of [...row].entries()) {
        ctx.fillStyle = {
          "#": "#486354",
          F: "#536e60",
          "=": "#7d9779",
          "+": "#acb68d",
          ".": "#829a80",
        }[ch];
        ctx.fillRect(x * 10, y * 10, 10, 10);
        if (ch === "#") {
          ctx.fillStyle = "#3c584b";
          ctx.fillRect(x * 10, y * 10 + 8, 10, 2);
        }
      }
    return c;
  }
  paint(canvas, small, now) {
    const ctx = canvas.getContext("2d"),
      s = this.state;
    ctx.imageSmoothingEnabled = false;
    const mix = reduced
      ? 1
      : Math.min(1, (now - this.start) / Math.max(this.duration, 1));
    const pos = {
      x: this.from.x + (s.position.x - this.from.x) * mix,
      y: this.from.y + (s.position.y - this.from.y) * mix,
    };
    const scale = !small && this.follow ? 1.65 : 1;
    const tile = small ? 10 : TILE;
    const px = (small ? 0 : LEFT) + (pos.x + 0.5) * tile,
      py = (small ? 0 : TOP) + (pos.y + 0.5) * tile;
    const offset = (v, size) =>
      Math.round(
        Math.min(0, Math.max(size - size * scale, size / 2 - v * scale)),
      );
    ctx.setTransform(
      scale,
      0,
      0,
      scale,
      offset(px, canvas.width),
      offset(py, canvas.height),
    );
    ctx.drawImage(small ? this.miniBase : floor, 0, 0);
    const phase =
      this.celebrate > now
        ? 4
        : this.walk && mix < 1
          ? (Math.floor(mix * 4) % 2) + 1
          : s.active && s.active.distance === 0
            ? Math.floor(now / 320) % 2
              ? 3
              : 0
            : 0;
    if (small) {
      ctx.fillStyle = "#233c32";
      ctx.fillRect(Math.round(px) - 4, Math.round(py) - 4, 8, 8);
      ctx.fillStyle = "#ffcf6d";
      ctx.fillRect(Math.round(px) - 3, Math.round(py) - 3, 6, 6);
    } else {
      const bob = !reduced && !this.walk && Math.floor(now / 800) % 2;
      ctx.drawImage(
        ranger,
        phase * 20,
        this.direction * 24,
        20,
        24,
        Math.round(px) - 10,
        Math.round(py) - 15 + (bob ? 1 : 0),
        20,
        24,
      );
    }
    const hits = [];
    const m = ctx.getTransform();
    for (const group of this.groups.values()) {
      group.forEach((task, index) => {
        const n = group.length,
          p = task.position;
        const age = now - this.since.get(task.id);
        const bounce =
          reduced || age > 350
            ? 0
            : Math.round(3 * Math.sin((Math.PI * age) / 350));
        const width = small ? 8 : 12,
          height = small ? 10 : 14;
        const baseX =
          (small ? 0 : LEFT) + (p.x + 0.5) * tile - width / 2 + (small ? 3 : 8);
        const x = Math.round(baseX + (index - (n - 1) / 2) * (small ? 7 : 11));
        const y = Math.round(
          (small ? 0 : TOP) +
            (p.y + 0.5) * tile -
            height -
            (small ? 1 : 5) -
            bounce,
        );
        ctx.drawImage(paper, x, y, width, height);
        const level = count[task.urgency];
        if (level) {
          const pulse = reduced
            ? 1
            : (1 + Math.sin(now / [1, 380, 230, 115][level])) / 2;
          for (let i = 0; i < level; i++) {
            const ax = x + Math.floor((width - level * 3) / 2) + i * 3;
            ctx.fillStyle = "#412c26";
            ctx.fillRect(ax - 1, y - 8, 4, 8);
            ctx.fillStyle =
              level === 3
                ? pulse > 0.5
                  ? "#ff724f"
                  : "#ffba81"
                : pulse > 0.5
                  ? "#ffd690"
                  : "#f8b86b";
            ctx.fillRect(ax, y - 7, 2, 4);
            ctx.fillRect(ax, y - 2, 2, 1);
          }
        }
        hits.push({
          id: task.id,
          x: x * m.a + m.e,
          y: y * m.d + m.f,
          w: width * m.a,
          h: height * m.d,
        });
      });
    }
    this.targets.set(canvas, hits);
    ctx.resetTransform();
  }
}
