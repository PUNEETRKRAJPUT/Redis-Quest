import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Minimal on purpose: recommended rules only, so later tasks do not fight the linter.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { console: 'readonly', process: 'readonly' } } },
);
