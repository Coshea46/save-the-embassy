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
