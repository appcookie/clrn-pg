export type ProbeFrame = { best_effort_timestamp_time?: string };

/** Validate encoded samples only. Media timestamps cannot prove wall-clock action coverage. */
export function validateRecordedTimeline(frames: ProbeFrame[], postTriggerWallMs: number) {
  if (!Number.isFinite(postTriggerWallMs) || postTriggerWallMs < 0) throw new Error('录屏动作计时必须为有效的非负毫秒数。');
  const timestampsMs = frames.map(frame => Number(frame.best_effort_timestamp_time) * 1000);
  if (frames.length < 20 || timestampsMs.some((time, index) => !Number.isFinite(time)
    || (index > 0 && time <= timestampsMs[index - 1]))) {
    throw new Error('模拟器录屏缺少足够的真实连续帧或有效时戳。');
  }
  const durationMs = timestampsMs.at(-1)! - timestampsMs[0];
  // Simulator media time and wall time differed in actual CI recordings. Keep both
  // for diagnostics; the animation assertions must establish coverage from pixels.
  return { timestampsMs: timestampsMs.map(time => time - timestampsMs[0]), durationMs, postTriggerWallMs };
}
