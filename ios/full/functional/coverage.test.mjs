/** 用真实 Playwright 收集结果核对源矩阵，防止遗漏、重复、错分组或 skip/x-fail 伪覆盖。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectPlaywright } from '../../../scripts/playwright-collection.mjs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const source = JSON.parse(readFileSync(new URL('../../../docs/web-coverage-source.json', import.meta.url), 'utf8'));
function collect(group) {
  const output = collectPlaywright(['--config', 'ios/full/playwright.config.ts', 'functional', '--list', '--reporter=json'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, IOS_GROUP: group }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000,
  });
  const report = JSON.parse(output); const specs = [];
  function visit(suite) { specs.push(...(suite.specs || [])); for (const child of suite.suites || []) visit(child); }
  for (const suite of report.suites) visit(suite);
  for (const spec of specs) {
    assert.equal(spec.tests.length, 1, '原生不复制桌面视口');
    assert.equal(spec.tests[0].expectedStatus, 'passed', `${spec.title}: 禁止 skip 或预期失败充当覆盖`);
    assert.ok(spec.tests[0].annotations.some(a => a.type === 'web-source'), `${spec.title}: 缺源证据`);
  }
  return specs;
}
test('覆盖 Web 60 个来源用例及新增搜索命中用例，54 个普通用例与 7 个创建用例互斥', () => {
  const variants = new Map();
  const expected = source.functional.map(entry => {
    const variant = (variants.get(entry.caseId) || 0) + 1; variants.set(entry.caseId, variant);
    return { title: `${entry.caseId}/${variant} ${entry.title}`, createsData: entry.createsData };
  });
  assert.equal(expected.length, 60); assert.equal(new Set(expected.map(e => e.title)).size, 60);
  const existing = collect('functional'); const creation = collect('functional-creation');
  assert.equal(existing.length, 54); assert.equal(creation.length, 7);
  assert.deepEqual(existing.map(e => e.title).sort(), [
    ...expected.filter(e => !e.createsData).map(e => e.title),
    'CLUB-007/1 俱乐部搜索命中固定结果并显示原生卡片',
  ].sort());
  assert.deepEqual(creation.map(e => e.title).sort(), expected.filter(e => e.createsData).map(e => e.title).sort());
});
test('8个交互和3个弱网实际注册且无伪通过状态', () => {
  const interaction = collect('interaction'); const network = collect('network');
  assert.deepEqual(interaction.map(e => e.title).sort(), [
    'INTERACTION-001 大厅滚动后回顶并打开搜索', 'INTERACTION-002 玩法弹层关闭重开与滑杆端点',
    'INTERACTION-003 俱乐部失败恢复后菜单可操作', 'INTERACTION-004 大厅失败重试恢复操作',
    'INTERACTION-005 我的虚拟列表后续菜单进入关于', 'INTERACTION-006 我的列表末项完整进入视口',
    'INTERACTION-007 横滑标签和游标分页追加、末页停止', 'INTERACTION-008 真实原生客服草稿清空、关闭与重开',
  ]);
  assert.deepEqual(network.map(e => e.title).sort(), [
    'NETWORK-001 大厅超时与真实重试恢复', 'NETWORK-002 登录失败退出 loading 并提示',
    'NETWORK-003 俱乐部错误重试仍失败，解除故障后真实恢复',
  ]);
});
