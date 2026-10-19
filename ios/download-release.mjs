// 从公开 Release 下载构建身份和可选模拟器包；测试仓库不读取应用源码。
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { artifactDirectory, deployment, githubRelease, releaseRepository, simulatorPackageName,
  validateBuild, verifySimulatorPackage } from './release.mjs';

const includeSimulator = process.argv.includes('--simulator');
const record = deployment();
const release = githubRelease(record);
mkdirSync(dirname(artifactDirectory), { recursive: true });
const temporary = mkdtempSync(join(dirname(artifactDirectory), '.release-'));
try {
  execFileSync('gh', ['release', 'download', record.release_tag, '--repo', releaseRepository,
    '--dir', temporary, '--pattern', 'build-info.json'], { stdio: 'inherit' });
  const information = validateBuild(JSON.parse(readFileSync(join(temporary, 'build-info.json'))), release, record);
  if (includeSimulator) {
    execFileSync('gh', ['release', 'download', record.release_tag, '--repo', releaseRepository,
      '--dir', temporary, '--pattern', simulatorPackageName], { stdio: 'inherit' });
    await verifySimulatorPackage(join(temporary, simulatorPackageName), information);
  }
  writeFileSync(join(temporary, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  rmSync(artifactDirectory, { recursive: true, force: true });
  renameSync(temporary, artifactDirectory);
  console.log(`iOS Release ${record.release_tag} → 应用提交 ${information.applicationCommit}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
