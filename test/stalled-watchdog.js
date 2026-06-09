const { captureStackTrace, getThreadsLastSeen } = require('@sentry/node-native-stacktrace');

const THRESHOLD = 500; // 1 second

const timer = setInterval(() => {
  for (const [_threadId, lastSeen] of Object.entries(getThreadsLastSeen())) {
    if (lastSeen > THRESHOLD) {
      // we don't want to run more than once
      clearInterval(timer);
      const stackTraces = captureStackTrace();
      console.log(JSON.stringify(stackTraces));
      process.exit(0)
    }
  }
}, 500);
