// A refresh can add images from a later run without attributing old PNGs to it.
export function validateBaselineSource(source) {
  if (!source || !Number.isSafeInteger(source.sourceRun) || source.sourceRun < 1
    || source.sourceUrl !== `https://github.com/appcookie/clrn-pg/actions/runs/${source.sourceRun}`
    || !/^[a-f0-9]{40}$/.test(source.sourceWorkflowHead || '')
    || !Array.isArray(source.sourceArtifacts) || !source.sourceArtifacts.length
    || source.sourceArtifacts.some(name => typeof name !== 'string' || !/^ios-[a-zA-Z0-9-]+$/.test(name))) {
    throw new Error('基准图片的 CI 来源记录无效。');
  }
}
