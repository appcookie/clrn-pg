// 校验 iOS 发布身份的失败路径，避免把真机包或错误应用提交混入模拟器回归。
import test from 'node:test';
import assert from 'node:assert/strict';
import { deployment, validateBuild, validateRelease } from './release.mjs';

const record = deployment();
const [, buildNumber, buildAttempt] = /^ios-staging-(\d+)-(\d+)-/.exec(record.release_tag);
const asset = (name, size, digest) => ({ name, size, digest, state: 'uploaded' });
const release = {
  tag_name: record.release_tag, draft: false, published_at: '2026-10-19T15:38:22Z',
  body: '<!-- laiwan-ios-package schema=1 -->',
  assets: [asset('build-info.json', 496), asset('ios-staging-simulator.zip', 66_616_221, `sha256:${'a'.repeat(64)}`)],
};
const build = {
  schemaVersion: 2, packageKind: 'simulator', platform: 'ios', environment: 'staging', applicationId: 'com.ac.laiwanDev',
  applicationCommit: record.sha, releaseTag: record.release_tag,
  buildNumber: Number(buildNumber), buildAttempt: Number(buildAttempt),
  package: { name: 'ios-staging-simulator.zip', size: 66_616_221, sha256: 'a'.repeat(64) },
};

test('锁定已发布的 iOS Staging Release 和应用源码提交', () => {
  assert.equal(validateBuild(build, validateRelease(release, record), record), build);
  assert.throws(() => validateBuild({ ...build, packageKind: 'device' }, release, record));
  assert.throws(() => validateBuild({ ...build, schemaVersion: 1 }, release, record));
  assert.throws(() => validateRelease({ ...release, draft: true }, record));
  assert.throws(() => validateBuild({ ...build, platform: 'android' }, release, record));
  assert.throws(() => validateBuild({ ...build, applicationCommit: 'b'.repeat(40) }, release, record));
  assert.throws(() => validateBuild({ ...build, package: { ...build.package, sha256: 'b'.repeat(64) } }, release, record));
});

test('下载内容必须同时匹配元数据大小和 SHA-256', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createHash } = await import('node:crypto');
  const { verifySimulatorPackage } = await import('./release.mjs');
  const directory = mkdtempSync(join(tmpdir(), 'clrn-release-test-'));
  try {
    const file = join(directory, 'simulator.zip');
    const contents = Buffer.from('simulator fixture');
    writeFileSync(file, contents);
    const info = { ...build, package: { name: build.package.name, size: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex') } };
    await verifySimulatorPackage(file, info);
    writeFileSync(file, Buffer.from('tampered! fixture'));
    await assert.rejects(verifySimulatorPackage(file, info), /SHA-256/);
    await assert.rejects(verifySimulatorPackage(file, { ...info, packageKind: 'device' }), /真机 IPA/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
