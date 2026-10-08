// Breadth limit: arrays/objects with more than 1000 entries are cut.
import { captureWhileBlocked } from './bounded-harness.mjs';

const range = n => Array.from({ length: n }, (_, i) => i);

const store = {
  wideArray: range(1500),
  exactArray: range(1000),
  wideObject: Object.fromEntries(range(1500).map(i => [`k${i}`, i])),
  exactObject: Object.fromEntries(range(1000).map(i => [`k${i}`, i])),
};

captureWhileBlocked({ store });
