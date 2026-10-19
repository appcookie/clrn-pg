/** 只在 GitHub 托管的临时 macOS runner 设置代理，持久化恢复日志供 always 步骤使用。 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function assertHostedRunner(environment = process.env, platform = process.platform) {
  if (platform !== 'darwin' || environment.GITHUB_ACTIONS !== 'true'
    || environment.RUNNER_ENVIRONMENT !== 'github-hosted' || !environment.RUNNER_TEMP) {
    throw new Error('系统代理仅允许在 GitHub 托管临时 macOS runner 配置；本机和 self-hosted 禁止修改。');
  }
}
export function journalPath(environment = process.env) {
  if (!environment.RUNNER_TEMP) throw new Error('缺少 RUNNER_TEMP');
  return path.join(environment.RUNNER_TEMP, 'clrn-ios-system-proxy.json');
}
function command(args, mutation = false) {
  return execFileSync(mutation ? 'sudo' : '/usr/sbin/networksetup',
    mutation ? ['-n', '/usr/sbin/networksetup', ...args] : args, { encoding: 'utf8' }).trim();
}
export function fields(output) {
  return Object.fromEntries(output.split('\n').map(line => {
    const index = line.indexOf(':');
    if (index < 0) throw new Error('无法解析网络代理状态');
    return [line.slice(0, index), line.slice(index + 1).trim()];
  }));
}
export function parseProxy(output) {
  const data = fields(output);
  if (!['Yes', 'No'].includes(data.Enabled) || !/^\d+$/.test(data.Port)
    || data['Authenticated Proxy Enabled'] !== '0' || typeof data.Server !== 'string') {
    throw new Error('无法完整恢复当前代理配置，或存在认证代理；未修改网络');
  }
  return { enabled: data.Enabled === 'Yes', server: data.Server, port: Number(data.Port) };
}
export function readSnapshot(run = command) {
  const services = run(['-listallnetworkservices']).split('\n').slice(1)
    .filter(name => name && !name.startsWith('*'));
  if (!services.length) throw new Error('没有可配置的网络服务');
  return services.map(service => {
    const pac = fields(run(['-getautoproxyurl', service]));
    const auto = run(['-getproxyautodiscovery', service]);
    if (!['Yes', 'No'].includes(pac.Enabled) || typeof pac.URL !== 'string'
      || !/^Auto Proxy Discovery: (On|Off)$/.test(auto)) throw new Error('无法解析 PAC/WPAD 状态');
    const bypass = run(['-getproxybypassdomains', service]);
    return { service, web: parseProxy(run(['-getwebproxy', service])),
      secure: parseProxy(run(['-getsecurewebproxy', service])), pac,
      discovery: auto.endsWith('On'), bypass: bypass.startsWith("There aren't any bypass domains") ? [] : bypass.split('\n') };
  });
}
export function applySnapshot(snapshot, port, run = command) {
  for (const { service, bypass } of snapshot) {
    run(['-setproxybypassdomains', service, ...new Set([...bypass, 'localhost', '127.0.0.1', '::1'])], true);
    run(['-setautoproxystate', service, 'off'], true);
    run(['-setproxyautodiscovery', service, 'off'], true);
    run(['-setwebproxy', service, '127.0.0.1', String(port), 'off'], true);
    run(['-setsecurewebproxy', service, '127.0.0.1', String(port), 'off'], true);
  }
}
export function restoreSnapshot(snapshot, run = command) {
  const failures = [];
  for (const item of snapshot) {
    const attempt = args => { try { run(args, true); } catch { failures.push(item.service); } };
    for (const [kind, proxy] of [['web', item.web], ['secureweb', item.secure]]) {
      // 空服务器是 networksetup 的合法初始状态；先清空配置，再恢复开关。
      attempt([`-set${kind}proxy`, item.service, proxy.server, String(proxy.port), 'off']);
      attempt([`-set${kind}proxystate`, item.service, proxy.enabled ? 'on' : 'off']);
    }
    // PAC URL 未改变，只恢复其开关，避免原始空 URL 被 networksetup 拒绝。
    attempt(['-setautoproxystate', item.service, item.pac.Enabled === 'Yes' ? 'on' : 'off']);
    attempt(['-setproxyautodiscovery', item.service, item.discovery ? 'on' : 'off']);
    attempt(['-setproxybypassdomains', item.service, ...(item.bypass.length ? item.bypass : ['Empty'])]);
  }
  if (failures.length) throw new Error('系统代理恢复失败；保留 journal 供 CI always 步骤重试');
}
export function restoreSystemProxy(environment = process.env) {
  assertHostedRunner(environment);
  const file = journalPath(environment);
  if (!existsSync(file)) return;
  const journal = JSON.parse(readFileSync(file, 'utf8'));
  if (journal.schema !== 1 || !Array.isArray(journal.snapshot)) throw new Error('代理恢复日志无效');
  restoreSnapshot(journal.snapshot);
  unlinkSync(file);
}
export function configureSystemProxy(server, environment = process.env) {
  assertHostedRunner(environment);
  const url = new URL(server);
  const port = Number(url.port);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
    || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('代理必须使用有效回环端口');
  const file = journalPath(environment);
  if (existsSync(file)) throw new Error('已有代理恢复日志，必须先执行 restore，禁止覆盖');
  const snapshot = readSnapshot();
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ schema: 1, snapshot }), { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
  try { applySnapshot(snapshot, port); }
  catch (error) {
    try { restoreSystemProxy(environment); } catch (cleanup) { throw new AggregateError([error, cleanup], '代理配置与回滚失败'); }
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== 'restore') throw new Error('用法：node ios/full/system-proxy.mjs restore');
  restoreSystemProxy();
}
