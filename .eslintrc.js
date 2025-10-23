module.exports = {
  extends: ['@sentry-internal/sdk'],
  env: {
    node: true,
    es2020: true
  },
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2020,
    project: './tsconfig.json',
  },
  ignorePatterns: ['lib/**/*'],
  rules: {},
  overrides: [
    {
      files: ['test/**'],
      rules: {
        'no-console': 'off',
        'no-unused-vars': 'off',
      }
    },
    {
      files: ['scripts/**'],
      rules: {
        'no-console': 'off',
      }
    },
  ],
};
