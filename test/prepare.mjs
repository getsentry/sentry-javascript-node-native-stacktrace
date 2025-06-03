
import { execSync, spawnSync } from 'node:child_process';
import {existsSync,readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const env = {...process.env, NODE_OPTIONS: '--no-deprecation'};

function installTarballAsDependency(root) {
  const pkgJson = require('../package.json');
  const normalizedName = pkgJson.name.replace('@', '').replace('/', '-');

  const tarball = join(__dirname, '..', `${normalizedName}-${pkgJson.version}.tgz`);

  if (!existsSync(tarball)) {
    console.error(`Tarball not found: '${tarball}'`);
    console.error('Run \'yarn build && yarn build:tarball\' first');
    process.exit(1);
  }

  const tarballRelative = relative(root, tarball);

  console.log('Clearing node_modules...');
  rmSync(join(root, 'node_modules'), { recursive: true, force: true });
  console.log('Clearing yarn.lock...');
  rmSync(join(root, 'yarn.lock'), { force: true });

  console.log('Clearing yarn cache...');
  spawnSync(`yarn cache clean ${pkgJson.name}`, { shell: true, stdio: 'inherit', env });
  // Yarn has a bug where 'yarn cache clean X' does not remove the temp directory where the tgz is unpacked to.
  // This means installing from local tgz does not update when src changes are made https://github.com/yarnpkg/yarn/issues/5357
  const dirResult = spawnSync('yarn cache dir', { shell: true, env });
  const tmpDir = join(dirResult.output.toString().replace(/[,\n\r]/g, ''), '.tmp');
  rmSync(tmpDir, { recursive: true, force: true });

  const pkg = readFileSync(join(root, 'package.json.template'), 'utf-8');
  const modified = pkg.replace(/"{{path}}"/, JSON.stringify(`file:${tarballRelative}`));
  writeFileSync(join(root, 'package.json'), modified);

  console.log('Installing dependencies...');
  execSync('yarn install', { cwd: root, stdio: 'inherit' });
}

installTarballAsDependency(__dirname);
