// AC4: getters in the state throw while it is serialized. The exceptions must
// not reach the interrupted JavaScript and the readable properties must be kept.
import { captureWhileBlocked } from './bounded-harness.mjs';

let throwingReads = 0;

function throwing(value) {
  return {
    enumerable: true,
    get() {
      throwingReads++;
      throw value;
    },
  };
}

const store = { ok: 1 };
Object.defineProperty(store, 'boom', throwing(new Error('getter boom')));
Object.defineProperty(store, 'boomValue', throwing('not an error'));
store.list = [1, 2, 3];
Object.defineProperty(store.list, 1, throwing(new Error('element boom')));
store.nested = { fine: 'yes' };
Object.defineProperty(store.nested, 'deep', throwing(new TypeError('nested boom')));
store.nested.alsoFine = 2;
store.after = 'kept';

captureWhileBlocked({ store, report: () => ({ throwingReads }) });
