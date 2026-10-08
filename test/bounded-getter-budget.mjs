// The read budget also bounds how often getters run: 1000 getters that each
// return the same object with 1000 getters would run 1,001,000 getters.
import { captureWhileBlocked } from './bounded-harness.mjs';

let getterReads = 0;

function withGetters(value) {
  const obj = {};
  for (let i = 0; i < 1000; i++) {
    Object.defineProperty(obj, `k${i}`, {
      enumerable: true,
      get() {
        getterReads++;
        return value(i);
      },
    });
  }
  return obj;
}

const inner = withGetters(i => i);
const outer = withGetters(() => inner);

captureWhileBlocked({ store: { outer }, report: () => ({ getterReads }) });
