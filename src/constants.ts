
import * as os from 'node:os';
import { versions } from 'node:process';
import * as libc from 'detect-libc';
import { getAbi } from 'node-abi';

export const stdlib = libc.familySync();
export const platform = process.env['BUILD_PLATFORM'] || os.platform();
export const arch = process.env['BUILD_ARCH'] || os.arch();
export const abi = getAbi(versions.node, 'node');
export const identifier = [platform, arch, stdlib, abi].filter(c => c !== undefined && c !== null).join('-');
