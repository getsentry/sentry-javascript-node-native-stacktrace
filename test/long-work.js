const crypto = require('node:crypto');

function longWork() {
  for (let i = 0; i < 200; i++) {
    const salt = crypto.randomBytes(128).toString('base64');
    const hash = crypto.pbkdf2Sync('myPassword', salt, 10000, 512, 'sha512');
    console.assert(hash);
  }
}

function foreverWork() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    longWork();
  }
}

module.exports = { longWork, foreverWork };
