// Helpers for the bounded-tojson-*.mjs fixtures

/** The state used by the toJSON fixtures, see 'inherited toJSON hooks' in e2e.test.mjs */
export function toJSONState() {
  return { text: 't', obj: { a: 1 }, list: [1, { b: 2 }, [3]] };
}

/**
 * Prepares toJSON hooks on Object.prototype and Array.prototype. They are only
 * installed while the main thread is blocked, so nothing else (e.g. printing
 * the result) sees them.
 */
export function installToJSONHooks({ object, array }) {
  let calls = 0;
  const counted = hook => function toJSON() {
    calls++;
    return hook();
  };

  return {
    install() {
      Object.defineProperty(Object.prototype, 'toJSON', { value: counted(object), configurable: true, writable: true });
      Object.defineProperty(Array.prototype, 'toJSON', { value: counted(array), configurable: true, writable: true });
    },
    restore() {
      delete Object.prototype.toJSON;
      delete Array.prototype.toJSON;
    },
    calls: () => calls,
  };
}
