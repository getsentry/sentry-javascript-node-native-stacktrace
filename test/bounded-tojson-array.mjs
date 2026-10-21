// Inherited toJSON hooks cannot change the serialized state: a throwing
// Object.prototype.toJSON and an oversized Array.prototype.toJSON.
import { captureWhileBlocked } from './bounded-harness.mjs';
import { installToJSONHooks, toJSONState } from './bounded-tojson.mjs';

const hooks = installToJSONHooks({
  object: () => {
    throw new Error('Object.prototype.toJSON boom');
  },
  array: () => 'x'.repeat(4 * 1024 * 1024),
});

captureWhileBlocked({
  store: toJSONState(),
  beforeBlock: hooks.install,
  afterBlock: hooks.restore,
  report: () => ({ toJSONCalls: hooks.calls() }),
});
