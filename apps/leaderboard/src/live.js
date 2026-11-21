// Coalesce bursts. A notification during an in-flight read must trigger another read.
export function watchBoard({
  read,
  paint,
  subscribe,
  onError,
  setState,
  interval = 8000,
  debounce = 180,
}) {
  let active = true,
    busy = false,
    dirty = false,
    timer;
  async function refresh() {
    if (!active) return;
    if (busy) {
      dirty = true;
      return;
    }
    busy = true;
    try {
      const snapshot = await read();
      if (active) paint(snapshot);
    } catch (error) {
      if (active) onError(error);
    } finally {
      busy = false;
      if (dirty) {
        dirty = false;
        schedule();
      }
    }
  }
  function schedule() {
    if (active && !timer)
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, debounce);
  }
  void refresh();
  const stop = subscribe(schedule, (state) => {
    setState(state);
    if (state === "SUBSCRIBED") schedule();
  });
  const poll = setInterval(schedule, interval);
  return () => {
    active = false;
    clearTimeout(timer);
    clearInterval(poll);
    stop();
  };
}

// A socket can reconnect before its Postgres filter is bound. Both acknowledgements
// are needed to label the board live and to associate incoming rows with its handler.
export function subscribeStandings(
  client,
  workshop,
  update,
  onState,
  event = "*",
) {
  let channel,
    timer,
    stopped = false,
    failures = 0;
  function connect() {
    if (stopped) return;
    let joined = false,
      listening = false;
    const current = client.channel("standings-" + crypto.randomUUID());
    channel = current;
    function ready() {
      if (channel === current && joined && listening) {
        clearTimeout(timer);
        failures = 0;
        onState("SUBSCRIBED");
      }
    }
    async function reconnect() {
      if (stopped || channel !== current) return;
      channel = null;
      clearTimeout(timer);
      onState("CONNECTING");
      await client.removeChannel(current);
      if (!stopped)
        timer = setTimeout(
          connect,
          Math.min(8000, 500 * 2 ** Math.min(failures++, 4)),
        );
    }
    timer = setTimeout(reconnect, 12000);
    current
      .on(
        "postgres_changes",
        {
          event,
          schema: "public",
          table: "embassy_standings",
          filter: "workshop_id=eq." + workshop,
        },
        update,
      )
      .on("system", {}, (message) => {
        if (message.extension !== "postgres_changes") return;
        if (message.status === "error") void reconnect();
        if (message.status === "ok") {
          listening = true;
          ready();
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          joined = true;
          ready();
        } else void reconnect();
      });
  }
  connect();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    if (channel) await client.removeChannel(channel);
  };
}
