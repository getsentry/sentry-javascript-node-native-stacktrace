// AC2: a graph of depth 24 where every level references the next level twice.
// Copying shared references once per path would produce 2^24 leaves.
import { captureWhileBlocked } from './bounded-harness.mjs';

let graph = { leaf: 'x' };
for (let i = 0; i < 24; i++) {
  graph = { a: graph, b: graph };
}

captureWhileBlocked({ store: graph });
