// Shallow but wide sharing: three levels of 1000 references to the next level
// (10^9 paths). Neither the depth nor the breadth limit bounds this graph, only
// the total number of visited values does.
import { captureWhileBlocked } from './bounded-harness.mjs';

let graph = { leaf: 1 };
for (let i = 0; i < 3; i++) {
  graph = new Array(1000).fill(graph);
}

captureWhileBlocked({ store: { graph } });
