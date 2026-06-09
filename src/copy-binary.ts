/* eslint-disable no-console */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { identifier } from './constants';

const source = path.join(__dirname, '..', 'build', 'Release', 'stack-trace.node');
const target = path.join(__dirname, '..', 'lib', `stack-trace-${identifier}.node`);

/**
 * Copies the compiled binary from the build directory to the lib directory with the correct name based on the current platform and Node version.
 *
 * @hidden We only use this for copying the binary after building, it is not intended to be used by end users.
 */
export function copyBinary(): void {
  const build = path.resolve(__dirname, '..', 'lib');
  if (!fs.existsSync(build)) {
    fs.mkdirSync(build, { recursive: true });
  }

  if (!fs.existsSync(source)) {
    throw new Error(`Source file does not exist: ${  source}`);
  } else {
    if (fs.existsSync(target)) {
      console.log('Target file already exists, overwriting it');
      fs.unlinkSync(target);
    }
    console.log('Copying', source, 'to', target);
    fs.copyFileSync(source, target);
  }
}
