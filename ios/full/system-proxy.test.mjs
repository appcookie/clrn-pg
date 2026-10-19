import assert from 'node:assert/strict';
import test from 'node:test';
import { assertHostedRunner, parseProxy, readSnapshot, applySnapshot, restoreSnapshot, proxyBypassDomains, runnerBypassDomains } from './system-proxy.mjs';

const raw = 'Enabled: No\nServer: \nPort: 0\nAuthenticated Proxy Enabled: 0';
const snapshot = [{ service: 'Ethernet primary', web: { enabled: false, server: '', port: 0 },
  secure: { enabled: true, server: 'original.proxy', port: 1234 },
  pac: { Enabled: 'Yes', URL: 'https://pac.example/proxy' }, discovery: true, bypass: ['*.internal', 'localhost'] }];

test('本机、self-hosted、错误平台与缺失RUNNER_TEMP均拒绝写系统代理', () => {
  const environment = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_TEMP: '/tmp' };
  assert.doesNotThrow(() => assertHostedRunner(environment, 'darwin'));
  for (const patch of [{ GITHUB_ACTIONS: undefined }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { RUNNER_TEMP: '' }]) {
    assert.throws(() => assertHostedRunner({ ...environment, ...patch }, 'darwin'));
  }
  assert.throws(() => assertHostedRunner(environment, 'linux'));
});
test('解析保留HTTP和HTTPS独立原值，认证或格式异常拒绝', () => {
  assert.deepEqual(parseProxy(raw), { enabled: false, server: '', port: 0 });
  for (const output of [raw.replace('Enabled: No', 'Enabled: unknown'), raw.replace('Port: 0', 'Port: nope'),
    raw.replace('Authenticated Proxy Enabled: 0', 'Authenticated Proxy Enabled: 1')]) assert.throws(() => parseProxy(output));
});
test('只枚举已启用服务且完整记录PAC/WPAD/bypass，不写系统', () => {
  const run = ([action]) => ({ '-listallnetworkservices': 'An asterisk (*) denotes disabled.\nEthernet primary\n*Disabled service',
    '-getautoproxyurl': 'URL: https://pac.example/proxy\nEnabled: Yes', '-getproxyautodiscovery': 'Auto Proxy Discovery: On',
    '-getproxybypassdomains': "There aren't any bypass domains set on Ethernet primary.",
    '-getwebproxy': raw, '-getsecurewebproxy': raw }[action]);
  const result = readSnapshot(run);
  assert.equal(result.length, 1);
  assert.equal(result[0].service, 'Ethernet primary');
  assert.deepEqual(result[0].bypass, []);
});
test('配置加入loopback绕过并关闭PAC，恢复独立开关与原始bypass', () => {
  const calls = [];
  const run = (args, mutation) => { assert.equal(mutation, true); calls.push(args); };
  applySnapshot(snapshot, 12345, run);
  assert.deepEqual(calls[0], ['-setproxybypassdomains', 'Ethernet primary', ...proxyBypassDomains(snapshot[0].bypass)]);
  assert.ok(calls.some(args => args[0] === '-setsecurewebproxy' && args[2] === '127.0.0.1'));
  calls.length = 0;
  restoreSnapshot(snapshot, run);
  assert.ok(calls.some(args => args.join('|') === '-setwebproxystate|Ethernet primary|off'));
  assert.ok(calls.some(args => args.join('|') === '-setsecurewebproxy|Ethernet primary|original.proxy|1234|off'));
  assert.ok(calls.some(args => args.join('|') === '-setsecurewebproxystate|Ethernet primary|on'));
  assert.ok(calls.some(args => args.join('|') === '-setautoproxystate|Ethernet primary|on'));
  assert.deepEqual(calls.at(-1), ['-setproxybypassdomains', 'Ethernet primary', '*.internal', 'localhost']);
});
test('恢复中一次失败仍尝试其他配置和服务，最终明确失败', () => {
  const calls = [];
  assert.throws(() => restoreSnapshot([...snapshot, { ...snapshot[0], service: 'Other' }], args => {
    calls.push(args); if (args[0] === '-setwebproxy') throw new Error('failure');
  }), /恢复失败/);
  assert.ok(calls.some(args => args[1] === 'Other' && args[0] === '-setproxybypassdomains'));
});


test('官方GitHub runner通信域名直连，业务API不被扩大绕过', () => {
  // 模拟 macOS 域名通配规则，验证 policy 本身；真实 CFNetwork 生效仍由 CI 验证。
  const bypass = proxyBypassDomains(['*.internal', 'github.com']);
  const matches = host => bypass.some(pattern => pattern.startsWith('*.')
    ? host.endsWith(pattern.slice(1)) : host === pattern);
  for (const host of ['github.com', 'api.github.com', 'codeload.github.com',
    'pipelines.actions.githubusercontent.com', 'vstoken.actions.githubusercontent.com',
    'results-receiver.actions.githubusercontent.com', 'productionresultssa.blob.core.windows.net',
    'objects.githubusercontent.com', 'objects-origin.githubusercontent.com',
    'github-releases.githubusercontent.com', 'github-registry-files.githubusercontent.com',
    'pkg-containers.githubusercontent.com', 'ghcr.io', 'github-cloud.githubusercontent.com',
    'github-cloud.s3.amazonaws.com', 'dependabot-actions.githubapp.com',
    'release-assets.githubusercontent.com', 'api.snapcraft.io', 'localhost', '127.0.0.1', '::1']) {
    assert.ok(matches(host), `runner通信必须直连：${host}`);
  }
  for (const host of ['api.shafayouxi.org', '64.kr-seoul.api.staging.laiwan.shafayouxi.com',
    'feedback.userreport.com', 'github.com.attacker.invalid']) {
    assert.equal(matches(host), false, `未扩大到无关/应用域名：${host}`);
  }
  assert.equal(bypass.filter(domain => domain === 'github.com').length, 1);
  assert.ok(bypass.includes('*.internal'));
});

test('runner bypass先于代理启用，恢复时不遗留新增域名', () => {
  const calls = [];
  const run = args => { calls.push(args); };
  applySnapshot(snapshot, 12345, run);
  const index = calls.findIndex(args => args[0] === '-setproxybypassdomains');
  assert.ok(runnerBypassDomains.every(domain => calls[index].includes(domain)));
  for (const [position, args] of calls.entries()) {
    if (args[0] === '-setwebproxy' || args[0] === '-setsecurewebproxy') assert.ok(position > index);
  }
  calls.length = 0;
  restoreSnapshot(snapshot, run);
  const restored = calls.find(args => args[0] === '-setproxybypassdomains');
  assert.deepEqual(restored.slice(2), snapshot[0].bypass);
});
