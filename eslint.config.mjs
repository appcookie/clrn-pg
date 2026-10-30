import tsParser from '@typescript-eslint/parser';
import { noNetworkFabrication } from './scripts/eslint-network-rule.mjs';

export default [{
  ignores: ['**/node_modules/**', '**/.venv/**', '**/.appium/**', '**/__pycache__/**', '.git/**', '.cache/**',
    'ios/artifacts/**', '**/playwright-report/**', '**/test-results/**'],
}, {
  files: ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}'],
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  // Suppression comments cannot silently bypass the migration inventory.
  linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  plugins: { architecture: { rules: { 'no-network-fabrication': noNetworkFabrication } } },
  rules: {
    complexity: ['error', { max: 10, variant: 'classic' }],
    'max-depth': ['error', 3],
    'architecture/no-network-fabrication': 'error',
  },
}, {
  // These adapter unit tests verify the response bridge itself; ordinary spec
  // and integration tests have no exception.
  files: ['ios/full/network-routes.test.mjs', 'ios/full/network-observer.test.ts'],
  rules: { 'architecture/no-network-fabrication': 'off' },
}];
