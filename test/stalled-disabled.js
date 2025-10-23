const { Worker } = require('node:worker_threads');
const { AsyncLocalStorage } = require('node:async_hooks');
const { longWork } = require('./long-work.js');
const { registerThread, threadPoll } = require('@sentry-internal/node-native-stacktrace');

const asyncLocalStorage = new AsyncLocalStorage();
asyncLocalStorage.enterWith({ some_property: 'some_value' });

registerThread({ asyncLocalStorage });

setInterval(() => {
  threadPoll(false);
}, 200).unref();

const watchdog = new Worker('./test/stalled-watchdog.js');
watchdog.on('exit', () => process.exit(0));

const worker = new Worker('./test/worker-do-nothing.js');

setTimeout(() => {
  longWork();

  setTimeout(() => {
    console.log('complete');
    process.exit(0);
  }, 1000);
}, 2000);

