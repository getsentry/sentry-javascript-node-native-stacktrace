// AC5: small states keep their JSON semantics: own enumerable string-keyed
// properties only, unsupported values dropped, cycles dropped, repeated
// (non-cyclic) references kept. Integer-like keys of objects stay left out, as
// before (see README "State serialization").
import { captureWhileBlocked } from './bounded-harness.mjs';

const state = Object.create({ inherited: 'from prototype' });
state.traceId = 'trace-5';
state.count = 3;
state.flag = true;
state.nothing = null;
state.big = 10n;
state.fn = () => {};
state.undef = undefined;
state[Symbol('symbolKey')] = 'symbol keyed';
Object.defineProperty(state, 'hidden', { value: 'not enumerable', enumerable: false });
state[7] = 'integer-like key';
state.self = state;
state.list = [1, 'two', undefined, () => {}, Symbol('symbolValue'), { deep: { deeper: true } }];
state.list.push(state.list);
state.shared = { x: 1 };
state.alsoShared = state.shared;

captureWhileBlocked({ store: { state }, stateLookup: ['state'] });
