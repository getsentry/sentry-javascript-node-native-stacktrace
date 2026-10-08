// AC4: the stateLookup path itself throws while the state is located.
import { captureWhileBlocked } from './bounded-harness.mjs';

let throwingReads = 0;

const store = {};
Object.defineProperty(store, 'scopes', {
  enumerable: true,
  get() {
    throwingReads++;
    throw new Error('lookup boom');
  },
});

captureWhileBlocked({ store, stateLookup: ['scopes'], report: () => ({ throwingReads }) });
