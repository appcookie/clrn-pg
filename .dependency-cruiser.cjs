module.exports = {
  forbidden: [{
    name: 'no-circular', severity: 'error', from: {}, to: { circular: true },
  }, {
    name: 'no-ui-response-implementation', severity: 'error',
    comment: 'UI、场景及普通测试不可导入响应实现；代理适配器单测仅精确允许以下两个文件。',
    from: { pathNot: '^ios/full/(network-routes\\.test\\.mjs|network-observer\\.test\\.ts)$' },
    to: { path: '^(visual/src/support/networkMocks\\.ts|ios/full/network-routes\\.ts|scripts/account-network-fixture\\.mjs)$' },
  }, {
    name: 'no-unresolved', severity: 'error', from: {}, to: { couldNotResolve: true },
  }],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: '(^|/)(node_modules|\\.venv|__pycache__|artifacts|playwright-report|test-results)/|^\\.git/|^\\.cache/',
    tsPreCompilationDeps: true,
    enhancedResolveOptions: { extensions: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.json'], conditionNames: ['import', 'require', 'node', 'default'], exportsFields: ['exports'] },
  },
};
