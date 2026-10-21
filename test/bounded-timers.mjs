// AC3: a Node Timeout in the state while 12,000 other timers with the same
// duration exist. Timers with the same duration form one linked list
// (_idlePrev/_idleNext), so the state references a 12,000 element chain.
import { captureWhileBlocked } from './bounded-harness.mjs';

const noop = () => {};
const timers = [];
for (let i = 0; i < 12000; i++) {
  // unref() keeps the timer in its list but lets the process exit
  timers.push(setTimeout(noop, 60000).unref());
}

const store = { profiler: { _chunkData: { timer: setTimeout(noop, 60000).unref() } } };

captureWhileBlocked({ store, report: () => ({ timers: timers.length }) });
