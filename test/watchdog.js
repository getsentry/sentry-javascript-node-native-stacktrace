const { captureStackTrace } = require('@sentry-internal/node-native-stacktrace');

setTimeout(() => {
    console.log(JSON.stringify(captureStackTrace()));
}, 1000);

