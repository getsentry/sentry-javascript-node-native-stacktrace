// threadPoll state goes through the same serializer: a shared-reference graph
// of depth 24 and a throwing getter must neither stall nor throw into the
// caller of threadPoll.
import { threadPoll } from '@sentry/node-native-stacktrace';
import { captureWhileBlocked } from './bounded-harness.mjs';

let graph = { leaf: 'x' };
for (let i = 0; i < 24; i++) {
  graph = { a: graph, b: graph };
}

let throwingReads = 0;
const pollState = { ok: 1, graph };
Object.defineProperty(pollState, 'boom', {
  enumerable: true,
  get() {
    throwingReads++;
    throw new Error('poll getter boom');
  },
});

let threadPollMs;
captureWhileBlocked({
  store: {},
  beforeBlock: () => {
    const start = performance.now();
    threadPoll(true, pollState);
    threadPollMs = performance.now() - start;
  },
  report: () => ({ throwingReads, threadPollMs }),
});
