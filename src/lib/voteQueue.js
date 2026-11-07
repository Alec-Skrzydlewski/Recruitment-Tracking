// Serializes writes per key (one recruit at one event). Rapid clicks never
// race: while a write is in flight only the LATEST desired value is queued,
// so the final stored score is always the last one the person picked.

export function createWriteQueue(send) {
  const lanes = new Map();

  function run(key) {
    const lane = lanes.get(key);
    if (!lane || lane.running || lane.next === undefined) return;
    const value = lane.next;
    const waiters = lane.waiters;
    lane.next = undefined;
    lane.waiters = [];
    lane.running = true;
    Promise.resolve()
      .then(() => send(key, value))
      .then(
        result => waiters.forEach(w => w.resolve({ ok: true, value, result, superseded: lane.next !== undefined })),
        error => waiters.forEach(w => w.resolve({ ok: false, value, error, superseded: lane.next !== undefined })),
      )
      .finally(() => {
        lane.running = false;
        if (lane.next === undefined) lanes.delete(key);
        else run(key);
      });
  }

  return {
    push(key, value) {
      const lane = lanes.get(key) || { running: false, next: undefined, waiters: [] };
      lanes.set(key, lane);
      lane.next = value;
      const done = new Promise(resolve => lane.waiters.push({ resolve }));
      run(key);
      return done;
    },
    pending(key) {
      return lanes.has(key);
    },
  };
}
