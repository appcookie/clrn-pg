// A refresh can add images from a later run without attributing old PNGs to it.
export function validateBaselineSource(source) {
  if (!source || !Number.isSafeInteger(source.sourceRun) || source.sourceRun < 1
    || source.sourceUrl !== `https://github.com/appcookie/clrn-pg/actions/runs/${source.sourceRun}`
    || !/^[a-f0-9]{40}$/.test(source.sourceWorkflowHead || '')
    || !Array.isArray(source.sourceArtifacts) || !source.sourceArtifacts.length
    || source.sourceArtifacts.some(name => typeof name !== 'string' || !/^ios-[a-zA-Z0-9-]+$/.test(name))) {
    throw new Error('基准图片的 CI 来源记录无效。');
  }
  // Existing files inherit the original collection's build. New images can
  // come from a later approved build without relabelling those old PNGs.
  const buildKeys = ['applicationCommit', 'releaseTag', 'packageSha256'];
  if (buildKeys.some(key => Object.hasOwn(source, key))) {
    if (!/^[a-f0-9]{40}$/.test(source.applicationCommit || '')
      || !/^ios-staging-[1-9]\d*-[1-9]\d*-[a-f0-9]{12}$/.test(source.releaseTag || '')
      || !source.applicationCommit.startsWith(source.releaseTag.slice(-12))
      || !/^[a-f0-9]{64}$/.test(source.packageSha256 || '')) {
      throw new Error('基准图片的独立构建来源不完整或不匹配。');
    }
  }
}
