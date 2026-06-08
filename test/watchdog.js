const { captureStackTrace } = require('@sentry/node-native-stacktrace');

setTimeout(() => {
    console.log(JSON.stringify(captureStackTrace()));
}, 1000);

