const { longWork } = require('./long-work');
const { registerThread } = require('@sentry/node-native-stacktrace');

registerThread();

longWork();
