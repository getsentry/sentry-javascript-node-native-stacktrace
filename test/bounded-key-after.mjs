// String budget used up exactly by retained keys and values: "ok" (2) + "a" (1)
// + the value of "a" (1048573) = 1 MiB. The value of "a" is kept whole, and
// the next key ("b") no longer fits, so the object ends with a marker.
import { captureWhileBlocked } from './bounded-harness.mjs';

const store = { ok: 1, a: 'y'.repeat(1024 * 1024 - 3), b: 2, c: 3 };

captureWhileBlocked({ store });
