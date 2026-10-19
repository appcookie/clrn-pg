// 执行于构建前：读取公开 Release 的构建身份，保存供构建及报告核对；不把真机 IPA 安装到模拟器。
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { artifactDirectory, deployment, githubRelease, releaseRepository, validateBuild } from './release.mjs';

const record = deployment();
const release = githubRelease(record);
mkdirSync(dirname(artifactDirectory), { recursive: true });
const temporary = mkdtempSync(join(dirname(artifactDirectory), '.release-'));
try {
  execFileSync('gh', ['release', 'download', record.release_tag, '--repo', releaseRepository,
    '--dir', temporary, '--pattern', 'build-info.json'], { stdio: 'inherit' });
  const information = validateBuild(JSON.parse(readFileSync(join(temporary, 'build-info.json'))), release, record);
  writeFileSync(join(temporary, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  rmSync(artifactDirectory, { recursive: true, force: true });
  renameSync(temporary, artifactDirectory);
  console.log(`iOS Release ${record.release_tag} → 应用提交 ${information.applicationCommit}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
