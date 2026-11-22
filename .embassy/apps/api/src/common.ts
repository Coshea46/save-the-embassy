import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";

export type DB = postgres.Sql;
export type Tx = postgres.TransactionSql;
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryMs?: number,
    public reason?: "simulation_pacing" | "rate_limit",
  ) {
    super(message);
  }
}
export function requireValue<T>(
  value: T | undefined | null,
  message = "Record not found",
): T {
  if (value == null) throw new HttpError(404, message);
  return value;
}
export const uuid = z.uuid();
export const name = z
  .string()
  .trim()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,31}$/,
    "Use 1–32 letters, numbers, spaces, hyphens or underscores",
  );
export const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{6,40}$/);
export const token = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const json = (value: unknown) => JSON.stringify(value);
export function checkPassword(password: string, encoded: string) {
  const [salt, key] = encoded.split(".");
  if (!salt || !key || !/^[0-9a-f]{128}$/.test(key)) return false;
  return timingSafeEqual(
    scryptSync(password, salt, 64),
    Buffer.from(key, "hex"),
  );
}
export async function membership(
  tx: Tx,
  workshop: string,
  participant: string,
) {
  const [member] =
    await tx`select * from embassy.members where workshop_id=${workshop} and participant_id=${participant} for update`;
  if (!member) throw new HttpError(403, "Join this workshop first");
  return member;
}
export async function project(
  tx: Tx,
  workshop: string,
  participant: string,
  display: string,
  notifyFinish = false,
) {
  // The caller holds the member lock. A finish changes public status even when the score stays level.
  const [best] =
    await tx`select score,survival_ticks from embassy.best where workshop_id=${workshop} and participant_id=${participant}`;
  if (!best) {
    await tx`delete from public.embassy_standings where workshop_id=${workshop} and display_name=${display}`;
    return;
  }
  await tx`insert into public.embassy_standings as p values (${workshop},${display},${best.score},${best.survival_ticks})
    on conflict(workshop_id,display_name) do update set score=excluded.score,survival_ticks=excluded.survival_ticks
    where ${notifyFinish} or (p.score,p.survival_ticks) is distinct from (excluded.score,excluded.survival_ticks)`;
}
