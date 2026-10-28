import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests for pure TypeScript only: the engine and the edge functions' runtime-agnostic
// helpers in supabase/functions/_shared. React Native code is verified by typecheck + bundling.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./supabase/functions/_shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: [
      'src/engine/**/*.test.ts',
      'src/lib/**/*.test.ts',
      'src/components/**/*.test.ts',
      'supabase/functions/_shared/**/*.test.ts',
    ],
    environment: 'node',
  },
});
