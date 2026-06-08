const { registerThread, threadPoll } = require('@sentry/node-native-stacktrace');

registerThread();

setInterval(() => {
  threadPoll();
}, 200);
