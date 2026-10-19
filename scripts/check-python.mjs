// 各代理目录单独运行，避免同名 addon.py 在 Python 模块缓存中互相覆盖。
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const python = resolve('e2e/.venv/bin/python');
for (const directory of ['ios/full', 'e2e/mitmproxy', 'visual/cases/texas-holdem/mitmproxy',
  'visual/cases/zhajinhua/mitmproxy', 'visual/cases/game-record/mitmproxy']) {
  const result = spawnSync(python, ['-m', 'unittest', 'discover', '-s', directory, '-p', 'test_*.py'], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const integration = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'ios/full/network-observer.test.ts'], {
  stdio: 'inherit', env: { ...process.env, MITMDUMP_PATH: resolve('e2e/.venv/bin/mitmdump') },
});
if (integration.error) throw integration.error;
process.exitCode = integration.status ?? 1;
