// 用 Simulator 录制原始 MP4，并固定采样率抽取动画帧用于后续版本对比。
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function recordAnimation(udid, directory) {
  mkdirSync(directory, { recursive: true });
  const video = join(directory, 'animation.mp4');
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--mask=ignored', '--force', video],
    { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let failure;
  let recordingStarted;
  child.stderr.on('data', bytes => {
    const output = stderr + bytes.toString();
    if (recordingStarted === undefined && output.includes('Recording started')) recordingStarted = performance.now();
    stderr = output.slice(-16_384);
  });
  child.on('error', error => { failure = error; });
  // 从创建进程起监听 close，避免漏掉提前退出。
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  try {
    // CI 首帧实际曾等待 12.6 秒；允许 30 秒启动，仍须收到真实开始信号。
    for (let attempt = 0; recordingStarted === undefined; attempt++) {
      if (failure) throw failure;
      if (child.exitCode !== null || attempt >= 300) throw new Error(`录屏未能启动：${stderr}`);
      await delay(100);
    }
    // CI 实测 4 秒墙钟时间只得到 2 秒媒体；媒体时长不等同于墙钟时间。
    // 延长录制，仍严格检查原始视频能提供完整采样窗口，不补帧掩盖缺失。
    await delay(8000);
  } finally {
    const stopping = performance.now();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGINT');
    // SIGINT 后 simctl 仍须编码已收集的帧并写完 MP4；保留有界等待和超时失败。
    const timeout = setTimeout(() => child.kill('SIGKILL'), 180_000);
    const result = await closed;
    clearTimeout(timeout);
    let fileSize = 0;
    try { fileSize = statSync(video).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const finished = performance.now();
    writeFileSync(join(directory, 'recording.json'), JSON.stringify({ startedAt,
      startupMs: recordingStarted === undefined ? null : Math.round(recordingStarted - started),
      recordingMs: recordingStarted === undefined || recordingStarted > stopping ? null : Math.round(stopping - recordingStarted),
      startedAfterStop: recordingStarted !== undefined && recordingStarted > stopping,
      stoppingMs: Math.round(finished - stopping), totalMs: Math.round(finished - started),
      code: result.code, signal: result.signal, fileSize, stderr,
      ...(failure ? { processError: failure.message } : {}) }, null, 2));
    if (result.signal === 'SIGKILL') throw new Error('模拟器录屏停止超时。');
    if ((result.signal && result.signal !== 'SIGINT') || (result.code && result.code !== 130)) {
      throw new Error(`模拟器录屏失败：${stderr}`);
    }
  }
  // 取启动后 0.5～3.5 秒的六帧，保留原始录屏供人工回看。
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video,
    '-ss', '0.5', '-t', '3', '-vf', 'fps=2', join(directory, 'frame-%02d.png')], { timeout: 60_000 });
  const frames = readdirSync(directory).filter(name => /^frame-\d+\.png$/.test(name)).sort();
  if (frames.length !== 6) throw new Error(`动画采样不完整：预期 6 帧，实际 ${frames.length}。`);
  return frames;
}
