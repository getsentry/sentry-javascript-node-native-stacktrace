// String budget applied to keys: the first key of an object does not fit into
// the 1 MiB string budget. The object is cut with a visible marker, and every
// later key (here "later" of the root object) is cut the same way.
import { captureWhileBlocked } from './bounded-harness.mjs';

const store = {
  first: { ['x'.repeat(1024 * 1024 + 1)]: 1, after: 2 },
  later: 'x',
};

captureWhileBlocked({ store });
