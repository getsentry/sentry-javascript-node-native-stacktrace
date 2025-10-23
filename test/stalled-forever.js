const { Worker } = require('node:worker_threads');
const { registerThread, threadPoll } = require('@sentry-internal/node-native-stacktrace');

registerThread();

setInterval(() => {
  threadPoll(true, { some_property: 'main_thread' });
}, 200).unref();

const watchdog = new Worker('./test/stalled-watchdog.js');
watchdog.on('exit', () => process.exit(0));

const worker = new Worker('./test/worker-forever.js');

