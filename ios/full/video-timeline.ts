export type ProbeFrame = { pts_time?: string };

/** Validate encoded samples only. Media timestamps cannot prove wall-clock action coverage. */
export function validateRecordedTimeline(frames: ProbeFrame[], postTriggerWallMs: number,
  minimumDistinctFrames = 20) {
  if (!Number.isFinite(postTriggerWallMs) || postTriggerWallMs < 0) throw new Error('录屏动作计时必须为有效的非负毫秒数。');
  if (!Number.isSafeInteger(minimumDistinctFrames) || minimumDistinctFrames < 2)
    throw new Error('真实录屏最小帧数必须至少为 2。');
  // Keep original presentation timestamps. FFmpeg best_effort may switch to DTS
  // after an equal PTS and introduce a false backwards jump in Simulator video.
  // Equal PTS retain both encoded frames; they do not count as elapsed motion.
  const timestampsMs = frames.map(frame => Number(frame.pts_time) * 1000);
  const invalidIndex = timestampsMs.findIndex((time, index) => !Number.isFinite(time)
    || (index > 0 && time < timestampsMs[index - 1]));
  const distinctFrames = new Set(timestampsMs).size;
  if (frames.length < minimumDistinctFrames || invalidIndex !== -1 || distinctFrames < minimumDistinctFrames) {
    throw new Error(`模拟器录屏缺少足够的真实连续帧或有效时戳。${JSON.stringify({
      encodedFrames: frames.length, distinctFrames, minimumDistinctFrames, invalidIndex,
      firstPts: frames[0]?.pts_time ?? null, lastPts: frames.at(-1)?.pts_time ?? null,
    })}`);
  }
  const durationMs = timestampsMs.at(-1)! - timestampsMs[0];
  // Simulator media time and wall time differed in actual CI recordings. Keep both
  // for diagnostics; the animation assertions must establish coverage from pixels.
  return { timestampSource: 'pts_time', repeatedTimestamps: frames.length - new Set(timestampsMs).size, timestampsMs: timestampsMs.map(time => time - timestampsMs[0]), durationMs, postTriggerWallMs };
}
