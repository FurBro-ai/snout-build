import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'node_modules/**/*', 'src/**/*', 'backend/**/*', 'shared/**/*'],
  },
  firebaseRulesPlugin.configs['flat/recommended'],
];
