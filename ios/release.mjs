// 校验部署记录、公开 Release 与构建元数据，确保模拟器应用来自目标提交。
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

export const applicationId = 'com.ac.laiwanDev';
export const releaseRepository = 'kevinanew/clrn';
export const artifactDirectory = resolve('ios/artifacts/release');
export const simulatorPackageName = 'ios-staging-simulator.zip';
const tagPattern = /^ios-staging-([1-9]\d*)-([1-9]\d*)-([a-f0-9]{12})$/;

export function deployment() {
  const record = JSON.parse(readFileSync(new URL('../deployments/ios-staging.json', import.meta.url)));
  if (record.environment !== 'staging' || !/^[a-f0-9]{40}$/.test(record.sha)
    || !tagPattern.test(record.release_tag) || !record.sha.startsWith(record.release_tag.slice(-12))) {
    throw new Error('iOS 部署记录无效。');
  }
  return record;
}

export function validateRelease(release, record) {
  if (release.draft || !release.published_at || release.tag_name !== record.release_tag
    || !release.body?.includes('<!-- laiwan-ios-package schema=1 -->')) {
    throw new Error('iOS Staging Release 未发布或身份不匹配。');
  }
  for (const name of ['build-info.json', simulatorPackageName]) {
    const assets = release.assets?.filter(asset => asset.name === name && asset.state === 'uploaded');
    if (assets?.length !== 1 || assets[0].size <= 0) throw new Error(`Release 缺少有效附件：${name}`);
  }
  return release;
}

export function validateBuild(information, release, record) {
  const match = tagPattern.exec(record.release_tag);
  const packageAsset = release.assets.find(asset => asset.name === simulatorPackageName);
  if (!match || information.schemaVersion !== 2 || information.packageKind !== 'simulator' || information.platform !== 'ios'
    || information.environment !== 'staging' || information.applicationId !== applicationId
    || information.applicationCommit !== record.sha || information.releaseTag !== record.release_tag
    || information.buildNumber !== Number(match[1]) || information.buildAttempt !== Number(match[2])
    || !packageAsset || information.package?.name !== simulatorPackageName || information.package.size !== packageAsset.size
    || !/^[a-f0-9]{64}$/.test(information.package.sha256)
    || (packageAsset.digest && packageAsset.digest !== `sha256:${information.package.sha256}`)) {
    throw new Error('iOS Release 构建元数据不匹配。');
  }
  return information;
}

export async function verifySimulatorPackage(file, information) {
  if (information.schemaVersion !== 2 || information.packageKind !== 'simulator' || information.package?.name !== simulatorPackageName) {
    throw new Error('这版 iOS Release 没有模拟器包；真机 IPA 无法用于模拟器测试。');
  }
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); size += chunk.length; }
  if (size !== information.package.size || hash.digest('hex') !== information.package.sha256) {
    throw new Error('模拟器包的大小或 SHA-256 不匹配。');
  }
}

export function readVerifiedBuild() {
  const record = deployment();
  const release = JSON.parse(readFileSync(resolve(artifactDirectory, 'release.json')));
  const information = JSON.parse(readFileSync(resolve(artifactDirectory, 'build-info.json')));
  return validateBuild(information, validateRelease(release, record), record);
}

export function githubRelease(record = deployment()) {
  const output = execFileSync('gh', ['api', `repos/${releaseRepository}/releases/tags/${record.release_tag}`],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return validateRelease(JSON.parse(output), record);
}
