const { registerThread, threadPoll } = require('@sentry-internal/node-native-stacktrace');

registerThread();

setInterval(() => {
  threadPoll();
}, 200);
