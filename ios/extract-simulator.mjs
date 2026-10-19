// 从已校验的 Release ZIP 安装模拟器包，核对应用版本与 Mach-O 平台后交给 Appium。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { applicationId, artifactDirectory, simulatorPackageName, verifySimulatorPackage } from './release.mjs';

export async function extractSimulator(information) {
  const archive = join(artifactDirectory, simulatorPackageName);
  await verifySimulatorPackage(archive, information);
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n').filter(Boolean);
  const roots = new Set(entries.map(name => name.split('/')[0]));
  if (entries.some(name => name.startsWith('/') || name.split('/').includes('..'))
    || roots.size !== 1 || ![...roots][0].endsWith('.app')) {
    throw new Error('模拟器 ZIP 必须只包含一个根目录 .app，且不能越界解压。');
  }
  const parent = resolve('ios/artifacts/simulator');
  mkdirSync(parent, { recursive: true });
  const temporary = mkdtempSync(join(parent, '.extract-'));
  try {
    execFileSync('ditto', ['-x', '-k', archive, temporary]);
    const applications = readdirSync(temporary).filter(name => name.endsWith('.app'));
    if (applications.length !== 1) throw new Error('模拟器 ZIP 中没有唯一的 .app。');
    const app = join(temporary, applications[0]);
    const info = join(app, 'Info.plist');
    if (!existsSync(info)) throw new Error('模拟器应用缺少 Info.plist。');
    const property = name => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print ${name}`, info],
      { encoding: 'utf8' }).trim();
    if (property('CFBundleIdentifier') !== applicationId
      || property('CFBundleShortVersionString') !== information.version
      || property('CFBundleVersion') !== information.applicationBuildNumber) {
      throw new Error('模拟器应用版本与 Release 元数据不匹配。');
    }
    const platform = execFileSync('xcrun', ['vtool', '-show-build', join(app, property('CFBundleExecutable'))],
      { encoding: 'utf8' });
    if (!platform.includes('IOSSIMULATOR')) throw new Error('附件不是 iOS Simulator 应用。');
    const current = join(parent, 'current');
    rmSync(current, { recursive: true, force: true });
    renameSync(temporary, current);
    return join(current, applications[0]);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
