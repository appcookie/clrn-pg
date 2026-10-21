export type ProbeFrame = { pts_time?: string };

// 候选池须有足够的真实帧；各场景另外验证选出的起点、中间和终点状态。
export const shortAnimationMinimumFrames = 10;

/** 从原片帧序选出时间递增的候选；异常原始PTS保留诊断，绝不排序、补帧或重写。 */
export function validateRecordedTimeline(frames: ProbeFrame[], postTriggerWallMs: number,
  minimumDistinctFrames = 20) {
  if (!Number.isFinite(postTriggerWallMs) || postTriggerWallMs < 0) throw new Error('录屏动作计时必须为有效的非负毫秒数。');
  if (!Number.isSafeInteger(minimumDistinctFrames) || minimumDistinctFrames < 2)
    throw new Error('真实录屏最小帧数必须至少为 2。');
  const originalTimestampsMs = frames.map(frame => typeof frame.pts_time === 'string' && frame.pts_time.trim()
    ? Number(frame.pts_time) * 1000 : NaN);
  const invalidIndex = originalTimestampsMs.findIndex(time => !Number.isFinite(time));
  const frameIndices: number[] = [], omittedFrameIndices: number[] = [];
  let latest = -Infinity;
  originalTimestampsMs.forEach((time, index) => {
    if (time > latest) { frameIndices.push(index); latest = time; }
    else omittedFrameIndices.push(index);
  });
  const distinctFrames = frameIndices.length;
  if (invalidIndex !== -1 || distinctFrames < minimumDistinctFrames) {
    throw new Error(`模拟器录屏缺少足够的真实候选帧或有效时戳。${JSON.stringify({
      encodedFrames: frames.length, distinctFrames, minimumDistinctFrames, invalidIndex,
      firstPts: frames[0]?.pts_time ?? null, lastPts: frames.at(-1)?.pts_time ?? null,
    })}`);
  }
  const selected = frameIndices.map(index => originalTimestampsMs[index]);
  // 归零仅用于播放器时间定位；对应的原始PTS和原始帧序同时保留。
  const timestampsMs = selected.map(time => time - selected[0]);
  return { timestampSource: 'pts_time', originalTimestampsMs, frameIndices, omittedFrameIndices,
    repeatedTimestamps: frames.length - new Set(originalTimestampsMs).size,
    backwardsTimestamps: originalTimestampsMs.filter((time, index) => index > 0 && time < originalTimestampsMs[index - 1]).length,
    timestampsMs, durationMs: timestampsMs.at(-1)!, postTriggerWallMs };
}
