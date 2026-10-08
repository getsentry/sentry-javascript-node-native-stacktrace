// Inherited toJSON hooks cannot change the serialized state: an oversized
// Object.prototype.toJSON and a throwing Array.prototype.toJSON.
import { captureWhileBlocked } from './bounded-harness.mjs';
import { installToJSONHooks, toJSONState } from './bounded-tojson.mjs';

const hooks = installToJSONHooks({
  object: () => 'x'.repeat(4 * 1024 * 1024),
  array: () => {
    throw new Error('Array.prototype.toJSON boom');
  },
});

captureWhileBlocked({
  store: toJSONState(),
  beforeBlock: hooks.install,
  afterBlock: hooks.restore,
  report: () => ({ toJSONCalls: hooks.calls() }),
});
