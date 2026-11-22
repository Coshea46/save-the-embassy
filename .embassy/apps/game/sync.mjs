import { batchLimit } from "@embassy/contracts";

// One timer and one in-flight request per run. Journal length is bounded by the
// scenario horizon: every scheduling decision advances at least one tick.
export class Synchroniser {
  constructor(session) {
    this.session = session;
    this.failures = 0;
  }
  wake(delay = 1000) {
    const s = this.session,
      d = s.data;
    if (
      this.stopped ||
      this.timer ||
      this.busy ||
      d.failure ||
      d.finished ||
      (d.ack === s.durable && !s.ended && !d.pending)
    )
      return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.flight = this.upload();
      },
      delay + Math.random() * 200,
    );
    this.timer.unref();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    return this.flight;
  }
  async upload() {
    const s = this.session,
      d = s.data;
    this.busy = true;
    let delay = 1000;
    try {
      // Save the batch boundary as well as the individual decision keys.
      d.pending ??=
        d.ack < s.durable
          ? { op: "batch", end: Math.min(s.durable, d.ack + batchLimit) }
          : { op: "finish", end: d.ack };
      await s.persist();
      const { op, end } = d.pending;
      const ids = { run_id: d.assignment.run_id };
      const body =
        op === "batch"
          ? { decisions: d.journal.slice(d.ack, end) }
          : { sequence: end, idempotency_key: d.finishKey };
      const ack = await s.call(op, ids, body, d.access_token);
      if (
        ack.run_id !== ids.run_id ||
        ack.next_sequence !== end ||
        (op === "finish" &&
          (ack.status !== s.game.sim.status ||
            ack.metrics.score !== s.game.sim.metrics.score))
      ) {
        throw Object.assign(
          new Error("Server replay differs from this local run."),
          { status: 409 },
        );
      }
      d.ack = end;
      d.verifiedScore = op === "finish" ? ack.metrics.score : ack.score;
      d.finished = op === "finish";
      d.pending = null;
      this.offline = false;
      this.failures = 0;
      await s.persist();
      if (s.ended || s.durable - d.ack >= batchLimit) delay = 100;
    } catch (error) {
      if (
        error.status >= 400 &&
        error.status < 500 &&
        ![408, 425, 429].includes(error.status)
      ) {
        d.failure = error.message;
        await s.persist();
      } else {
        this.offline = true;
        this.failures++;
        delay = Math.max(
          error.retryMs ?? 0,
          Math.min(30000, 1000 * 2 ** Math.min(this.failures - 1, 5)),
        );
        delay += (Math.random() * delay) / 3;
      }
    } finally {
      this.busy = false;
      this.wake(delay);
    }
  }
}
