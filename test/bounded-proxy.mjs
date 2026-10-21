// Proxies in the state become "[Proxy]" without running any trap. Every
// operation on a proxy looks up its trap on the handler, so a handler that is
// itself a proxy records each trap V8 would run.
import { captureWhileBlocked } from './bounded-harness.mjs';

const trapLookups = [];
const recordingHandler = new Proxy(
  {},
  {
    get(_, trap) {
      trapLookups.push(String(trap));
      return undefined; // no trap: the operation goes to the target
    },
  },
);

const revocable = Proxy.revocable({ revoked: true }, {});
revocable.revoke();

const store = {
  before: 1,
  plain: new Proxy({ secret: 'object target' }, recordingHandler),
  list: [new Proxy(['array target'], recordingHandler), 2],
  revoked: revocable.proxy,
  after: 'kept',
};

captureWhileBlocked({ store, report: () => ({ trapLookups }) });
