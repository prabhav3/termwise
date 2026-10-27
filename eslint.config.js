// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Functions are Deno (checked with `npm run check:functions` / `deno lint`).
    ignores: ['dist*/**', 'supabase/functions/**', 'scripts/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // TypeScript already verifies namespace members; this rule can't follow `export *` in
      // packages like expo-notifications and reports false positives.
      'import/namespace': 'off',
    },
  },
]);
