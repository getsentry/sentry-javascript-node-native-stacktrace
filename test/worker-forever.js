const { foreverWork } = require('./long-work');
const { registerThread, threadPoll } = require('@sentry-internal/node-native-stacktrace');

registerThread();

setInterval(() => {
  threadPoll(true, { some_property: 'worker_thread' });
}, 200).unref();

setTimeout(() => {
  console.log('Starting forever work');
  foreverWork();
}, 1000);
