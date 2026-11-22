import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { rest, type Catalogue } from "@embassy/contracts";
import {
  type DB,
  type Tx,
  checkPassword,
  code,
  hash,
  HttpError,
  name,
  requireValue,
  token,
  uuid,
  membership,
  project,
} from "./common.js";
import { OFFICIAL_TICK_MS } from "./index.js";
import { start, runAction, scenarioLoader } from "./runs.js";
import { createWorkshop, manage, monitor, snapshot } from "./workshops.js";

export interface Settings {
  origin: string;
  organiser: string;
  passwordHash: string;
  supabaseUrl?: string;
  publishableKey?: string;
  catalogue?: Catalogue;
  trustProxy?: string;
}
const cookie = "embassy_organiser";
// Four decisions per second, a retry for each, and room for recovery requests.
const participantRequestsPerMinute = 600;
const cookieToken = (req: Request) =>
  /(?:^|;\s*)embassy_organiser=([A-Za-z0-9_-]{43})(?:;|$)/.exec(
    req.get("cookie") ?? "",
  )?.[1];
async function limit(db: DB, key: string, max: number, seconds: number) {
  const [row] =
    await db`insert into embassy.rate_limits as r values(${hash(key)},1,clock_timestamp()+${seconds}*interval '1 second')
    on conflict(bucket) do update set hits=case when r.until_at<=clock_timestamp() then 1 else r.hits+1 end,
    until_at=case when r.until_at<=clock_timestamp() then excluded.until_at else r.until_at end
    returning hits,ceil(extract(epoch from until_at-clock_timestamp())*1000)::int delay`;
  if (row!.hits > max)
    throw new HttpError(
      429,
      "Request limit reached",
      Math.max(1, row!.delay),
      "rate_limit",
    );
}
async function participant(db: DB, req: Request) {
  const value = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(
    req.get("authorization") ?? "",
  )?.[1];
  if (!value) throw new HttpError(401, "Participant bearer token required");
  const [s] =
    await db`select participant_id from embassy.sessions where token_hash=${hash(value)} and expires_at>clock_timestamp()`;
  if (!s) throw new HttpError(401, "Invalid or expired session");
  await limit(
    db,
    "participant:" + s.participant_id,
    participantRequestsPerMinute,
    60,
  );
  return String(s.participant_id);
}
export function createApp(db: DB, config: Settings) {
  const loadScenario = scenarioLoader();
  const app = express(),
    secure = new URL(config.origin).protocol === "https:";
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' ${config.supabaseUrl ?? ""} ${(config.supabaseUrl ?? "").replace(/^http/, "ws")}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    });
    if (secure) res.set("Strict-Transport-Security", "max-age=31536000");
    if (
      req.method === "POST" &&
      req.get("origin") &&
      req.get("origin") !== config.origin
    )
      return next(new HttpError(403, "Origin mismatch"));
    next();
  });
  app.use(express.json({ limit: "8kb", strict: true }));
  app.get("/health/live", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/health/ready", async (_req, res) => {
    await db`select workshop_id from public.embassy_standings limit 0`;
    res.json({ ok: true });
  });
  const staticDir = fileURLToPath(
    new URL("../../leaderboard/dist/", import.meta.url),
  );
  app.get(
    ["/", "/organiser", "/join", "/board/:id", "/projector/:id"],
    (_req, res) => res.sendFile("index.html", { root: staticDir }),
  );
  app.use(
    "/assets",
    express.static(staticDir + "assets", {
      immutable: true,
      maxAge: "1y",
      index: false,
    }),
  );
  app.get("/config", (_req, res) =>
    res.json({
      url: config.supabaseUrl ?? null,
      key: config.publishableKey ?? null,
    }),
  );
  app.use(async (req, _res, next) => {
    // A shared venue IP can carry 200 players. Budget one pacing retry per
    // simulated tick for run traffic, including clients without wait hints.
    const runTraffic =
      /^\/(?:v2\/)?runs\/[^/]+(?:\/(?:decisions|finish))?\/?$/.test(req.path);
    await limit(
      db,
      (runTraffic ? "runs-ip:" : "ip:") + req.ip,
      runTraffic ? 200 * participantRequestsPerMinute : 18000,
      60,
    );
    next();
  });
  app.post("/participants", async (req, res) => {
    await limit(db, "register:" + req.ip, 1200, 600);
    const display = name.parse(
        rest.register.request.parse(req.body).display_name,
      ),
      id = randomUUID(),
      credential = token();
    await db.begin(async (tx) => {
      await tx`insert into embassy.participants values(${id},${display})`;
      await tx`insert into embassy.sessions(token_hash,participant_id) values(${hash(credential)},${id})`;
    });
    res.status(201).json(
      rest.register.response.parse({
        participant_id: id,
        access_token: credential,
      }),
    );
  });
  app.post("/workshops/resolve", async (req, res) => {
    await limit(db, "resolve:" + req.ip, 1000, 600);
    const input = z.strictObject({ join_code: code }).parse(req.body);
    res.json(
      requireValue(
        (
          await db`select id workshop_id,title from embassy.workshops where code_hash=${hash(input.join_code)} and registration`
        )[0],
        "Open workshop not found",
      ),
    );
  });
  app.post("/workshops/:id/join", async (req, res) => {
    const id = uuid.parse(req.params.id),
      owner = await participant(db, req),
      key = code.parse(rest.join.request.parse(req.body).join_code);
    res.json(
      await db.begin(async (tx) => {
        const w = requireValue(
          (
            await tx`select * from embassy.workshops where id=${id} for share`
          )[0],
        );
        if (w.code_hash !== hash(key))
          throw new HttpError(403, "Invalid join code");
        const [prior] =
          await tx`select 1 from embassy.members where workshop_id=${id} and participant_id=${owner}`;
        if (!prior) {
          if (!w.registration) throw new HttpError(409, "Registration closed");
          await tx`insert into embassy.members select ${id},id,name from embassy.participants where id=${owner} on conflict(workshop_id,participant_id) do nothing`;
        }
        return rest.join.response.parse({
          workshop_id: id,
          participant_id: owner,
        });
      }),
    );
  });
  app.post(
    ["/workshops/:id/runs", "/v2/workshops/:id/runs"],
    async (req, res) => {
      const owner = await participant(db, req),
        id = uuid.parse(req.params.id);
      const protocol = req.path.startsWith("/v2/") ? 2 : 1;
      if (protocol === 1) res.set("Embassy-Tick-Ms", String(OFFICIAL_TICK_MS));
      res.json(
        await db.begin((tx) =>
          start(tx, id, owner, req.body, loadScenario, protocol),
        ),
      );
    },
  );
  app.get("/workshops/:id/me", async (req, res) => {
    const owner = await participant(db, req),
      id = uuid.parse(req.params.id);
    res.json(
      await db`select id run_id,next_sequence,finished_at,exclusion,deadline from embassy.runs where workshop_id=${id} and participant_id=${owner} order by started_at desc`,
    );
  });
  for (const [method, path, action] of [
    ["post", "/v2/runs/:id/decisions", "batch"],
    ["get", "/runs/:id", "status"],
    ["post", "/runs/:id/decisions", "decide"],
    ["post", "/runs/:id/finish", "finish"],
  ] as const) {
    app[method](path, async (req, res) => {
      const id = uuid.parse(req.params.id),
        owner = await participant(db, req);
      if (action === "decide")
        res.set("Embassy-Tick-Ms", String(OFFICIAL_TICK_MS));
      if (action === "status") rest.status.request.parse(req.query);
      res.json(
        await db.begin((tx) =>
          runAction(tx, action, id, owner, req.body, loadScenario, (ms) => {
            res.set("Embassy-Next-Wait-Ms", String(ms));
          }),
        ),
      );
    });
  }
  app.get("/workshops/:id/leaderboard", async (req, res) => {
    rest.leaderboard.request.parse(req.query);
    const id = uuid.parse(req.params.id);
    requireValue(
      (await db`select id from embassy.workshops where id=${id}`)[0],
    );
    const entries =
      await db`select rank() over(order by score desc,survival_ticks desc)::int rank,display_name,score,survival_ticks
      from embassy.best where workshop_id=${id} order by score desc,survival_ticks desc,run_id`;
    res.json(rest.leaderboard.response.parse({ workshop_id: id, entries }));
  });
  app.get("/workshops/:id/display", async (req, res) =>
    res.json(
      await db.begin("isolation level repeatable read read only", (tx) =>
        snapshot(tx, uuid.parse(req.params.id)),
      ),
    ),
  );
  app.post("/admin/login", async (req, res) => {
    await limit(db, "login:" + req.ip, 10, 300);
    const input = z
      .strictObject({
        username: z.string().max(80),
        password: z.string().min(1).max(256),
      })
      .parse(req.body);
    if (
      !checkPassword(input.password, config.passwordHash) ||
      input.username !== config.organiser
    )
      throw new HttpError(401, "Invalid credentials");
    const secret = token();
    await db`insert into embassy.organiser_sessions(token_hash,actor) values(${hash(secret)},${config.organiser})`;
    res
      .cookie(cookie, secret, {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: "/admin",
        maxAge: 8 * 3600000,
      })
      .json({ ok: true });
  });
  app.use("/admin", async (req, res, next) => {
    const credential = cookieToken(req);
    const [session] = credential
      ? await db`select actor from embassy.organiser_sessions where token_hash=${hash(credential)} and expires_at>clock_timestamp()`
      : [];
    if (!session) throw new HttpError(401, "Organiser login required");
    res.locals.actor = session.actor;
    next();
  });
  app.post("/admin/logout", async (req, res) => {
    await db`delete from embassy.organiser_sessions where token_hash=${hash(cookieToken(req)!)}`;
    res.clearCookie(cookie, { path: "/admin" }).json({ ok: true });
  });
  app.get("/admin/workshops", async (_req, res) =>
    res.json(
      await db`select id,title,phase,registration,attempt_limit,entry_minutes,prize from embassy.workshops order by created_at desc`,
    ),
  );
  app.post("/admin/workshops", async (req, res) =>
    res
      .status(201)
      .json(
        await db.begin((tx) =>
          createWorkshop(tx, res.locals.actor, req.body, config.catalogue),
        ),
      ),
  );
  app.post("/admin/workshops/:id", async (req, res) =>
    res.json(
      await db.begin((tx) =>
        manage(tx, uuid.parse(req.params.id), res.locals.actor, req.body),
      ),
    ),
  );
  app.get("/admin/workshops/:id", async (req, res) =>
    res.json(
      await db.begin("isolation level repeatable read read only", (tx) =>
        monitor(tx, uuid.parse(req.params.id)),
      ),
    ),
  );
  app.get("/admin/runs/:id/decisions", async (req, res) =>
    res.json(
      await db`select sequence,selected_task_id,idempotency_key,response,committed_at from embassy.decisions where run_id=${uuid.parse(req.params.id)} order by sequence`,
    ),
  );
  app.get("/admin/workshops/:id/export", async (req, res) => {
    const board = await db.begin(
      "isolation level repeatable read read only",
      (tx) => snapshot(tx, uuid.parse(req.params.id)),
    );
    res
      .attachment("standings.csv")
      .type("text/csv")
      .send(
        [
          "rank,display_name,score,survival_ticks,completed,status,finalised",
          ...board.entries.map((e) =>
            [
              e.rank,
              e.display_name,
              e.score,
              e.survival_ticks,
              e.completed,
              e.status,
              e.finalised,
            ].join(","),
          ),
        ].join("\r\n"),
      );
  });
  app.use((_req, _res, next) => next(new HttpError(404, "Route not found")));
  app.use(
    (
      err: Error & { type?: string; code?: string },
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      const problem =
        err instanceof HttpError
          ? err
          : err instanceof z.ZodError
            ? new HttpError(422, err.issues.map((i) => i.message).join(", "))
            : err.type === "entity.too.large"
              ? new HttpError(413, "Request too large")
              : err.type === "entity.parse.failed"
                ? new HttpError(400, "Invalid JSON")
                : err.code === "23505"
                  ? new HttpError(409, "Name, code or request already in use")
                  : new HttpError(500, "Internal server error");
      if (problem.status === 500)
        console.error(
          "platform_error",
          err.name,
          err.code ?? "",
          err.message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[connection]"),
        );
      if (problem.retryMs)
        res.set("Retry-After", String(Math.ceil(problem.retryMs / 1000)));
      res.status(problem.status).json({
        error: problem.message,
        ...(problem.reason ? { reason: problem.reason } : {}),
        ...(problem.retryMs ? { retry_ms: problem.retryMs } : {}),
      });
      void _next;
    },
  );
  return app;
}
export async function sweep(db: DB) {
  const due =
    await db`select id,workshop_id,participant_id from embassy.runs where finished_at is null and exclusion is null and deadline<clock_timestamp() order by deadline limit 200`;
  for (const r of due)
    await db.begin(async (tx: Tx) => {
      const m = await membership(tx, r.workshop_id, r.participant_id);
      const changed =
        await tx`update embassy.runs set exclusion='expired' where id=${r.id} and finished_at is null and exclusion is null and deadline<clock_timestamp() returning id`;
      if (changed.length)
        await project(tx, r.workshop_id, r.participant_id, m.display_name);
    });
  await db`delete from embassy.rate_limits where until_at<clock_timestamp()-interval '1 hour'`;
  await db`delete from embassy.organiser_sessions where expires_at<clock_timestamp()`;
  await db`delete from embassy.sessions where expires_at<clock_timestamp()`;
}
