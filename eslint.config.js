import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'supabase/functions', 'e2e', 'tools'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { plugins: { 'react-hooks': reactHooks }, rules: { ...reactHooks.configs.recommended.rules } },
  // scripts/*.mjs run in Node.js at build time (Cloudflare build, release check), not in the browser:
  // declare exactly the Node globals they use. The browser code under src/ keeps the browser-only environment.
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', URL: 'readonly' } } },
);
