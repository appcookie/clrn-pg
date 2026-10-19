// 在独立的应用源码检出中构建 Staging Release 模拟器包；构建结果供 run.mjs 安装。
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readVerifiedBuild } from './release.mjs';

const information = readVerifiedBuild();
const source = resolve(process.env.IOS_APP_SOURCE_DIR || '../laiwan_react_native');
if (!existsSync(join(source, 'ios/laiwan_react_native.xcworkspace'))) throw new Error('缺少应用 iOS workspace。');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
if (commit !== information.applicationCommit) {
  throw new Error(`应用源码提交 ${commit} 与 Release ${information.applicationCommit} 不同。`);
}
if (!existsSync(join(source, 'ios/Pods/Manifest.lock'))) throw new Error('请先在应用源码中安装 CocoaPods 依赖。');
const derived = resolve('ios/artifacts/derived');
mkdirSync(derived, { recursive: true });
const command = ['build', '-workspace', join(source, 'ios/laiwan_react_native.xcworkspace'),
  '-scheme', 'laiwan_react_native', '-configuration', 'Release', '-sdk', 'iphonesimulator',
  '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', derived,
  'CODE_SIGNING_ALLOWED=NO'];
const result = spawnSync('xcodebuild', command, { cwd: source, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`iOS Simulator 构建失败：${result.status}`);
const app = join(derived, 'Build/Products/Release-iphonesimulator/laiwan_react_native.app');
if (!existsSync(app)) throw new Error(`构建成功但找不到模拟器应用：${app}`);
writeFileSync(resolve('ios/artifacts/simulator-app.json'), `${JSON.stringify({ app, applicationCommit: commit,
  releaseTag: information.releaseTag }, null, 2)}\n`);
console.log(`模拟器应用：${app}`);
