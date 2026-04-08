# Changelog

## 0.4.0

### New Features ✨

- Support V8 v14 by @timfish in [#32](https://github.com/getsentry/sentry-javascript-node-native-stacktrace/pull/32)

### Bug Fixes 🐛

- (security) Replace execSync with execFileSync to prevent command injection by @fix-it-felix-sentry in [#30](https://github.com/getsentry/sentry-javascript-node-native-stacktrace/pull/30)

### Internal Changes 🔧

#### Release

- Fix changelog-preview permissions by @BYK in [#29](https://github.com/getsentry/sentry-javascript-node-native-stacktrace/pull/29)
- Bump Craft version to fix issues by @BYK in [#27](https://github.com/getsentry/sentry-javascript-node-native-stacktrace/pull/27)
- Switch from action-prepare-release to Craft by @BYK in [#25](https://github.com/getsentry/sentry-javascript-node-native-stacktrace/pull/25)

#### Other

- Update Craft version by @timfish in [#34](https://github.com/getsentry/sentry-javascript-node-native-stacktrace/pull/34)
- Enable Craft auto changelog by @timfish in [#33](https://github.com/getsentry/sentry-javascript-node-native-stacktrace/pull/33)
- Pin GitHub Actions to full-length commit SHAs by @joshuarli in [#31](https://github.com/getsentry/sentry-javascript-node-native-stacktrace/pull/31)
- Use pull_request_target for changelog preview by @BYK in [#28](https://github.com/getsentry/sentry-javascript-node-native-stacktrace/pull/28)
- `macos-13` deprecation by @timfish in [#26](https://github.com/getsentry/sentry-javascript-node-native-stacktrace/pull/26)

## 0.3.0

- feat: Capture thread state from `AsyncLocalStorage` store (#24)

## 0.2.3

- fix: Failing install script (#22)

## 0.2.2

- fix: when tracking threads, use a monotonic clock that ignores system suspension (#14)
- ci: Build Linux in container for wider glibc support (#15)

Thanks to @matthew-nicholson-anrok for their contribution!

## 0.2.1

- fix: Correct the Electron warning log message

## 0.2.0

- feat: Allow disabling of watchdog tracking per thread (#11)

## 0.1.1

- meta: Improve `README.md`, `package.json` metadata and add `LICENSE` (#10)

## 0.1.0

Initial release
