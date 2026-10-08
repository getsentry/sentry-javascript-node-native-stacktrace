// Depth limit with Sentry's state shape: the state is looked up like
// eventLoopBlockIntegration does (stateLookup ['_currentContext', scopes symbol])
// and breadcrumb data sits at isolationScope._breadcrumbs[i].data.
import { captureWhileBlocked } from './bounded-harness.mjs';

const SCOPES = Symbol.for('sentry_scopes');

function nest(depth, wrap, leaf) {
  let value = leaf;
  for (let i = 0; i < depth; i++) {
    value = wrap(value);
  }
  return value;
}

const scopes = {
  isolationScope: {
    _breadcrumbs: [
      {
        category: 'console',
        data: { arguments: [{ a: { b: { c: { d: { e: 'deep' } } } } }] },
      },
    ],
  },
  objectChain: nest(15, child => ({ child }), 'leaf'),
  arrayChain: nest(15, child => [child], 'leaf'),
};

captureWhileBlocked({
  store: { _currentContext: new Map([[SCOPES, scopes]]) },
  stateLookup: ['_currentContext', SCOPES],
});
