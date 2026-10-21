// String budget: one large string referenced many times. Each reference would
// otherwise be copied into the output again.
//
// The string is made of surrogate pairs and the key "items" has an odd length,
// so the remaining budget (1 MiB - 5 - 3 * 307200 = 126971 code units) ends in
// the middle of a pair and the cut must not leave a lone surrogate behind.
import { captureWhileBlocked } from './bounded-harness.mjs';

const big = '\u{1F600}'.repeat(150 * 1024); // 307200 UTF-16 code units
const items = new Array(8).fill(big);

captureWhileBlocked({ store: { state: { items } }, stateLookup: ['state'], report: () => ({ bigLength: big.length }) });
