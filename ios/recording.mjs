// 用 Simulator 录制原始 MP4，并固定采样率抽取动画帧用于后续版本对比。
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function recordAnimation(udid, directory) {
  mkdirSync(directory, { recursive: true });
  const video = join(directory, 'animation.mp4');
  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--mask=ignored', '--force', video]);
  let stderr = '';
  let failure;
  child.stderr.on('data', bytes => { stderr += bytes.toString(); });
  child.on('error', error => { failure = error; });
  // 从创建进程起监听 close，避免漏掉提前退出。
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve({ code, signal })));
  try {
    for (let attempt = 0; !stderr.includes('Recording started'); attempt++) {
      if (failure) throw failure;
      if (child.exitCode !== null || attempt >= 100) throw new Error(`录屏未能启动：${stderr}`);
      await delay(100);
    }
    // CI 实测 4 秒墙钟时间只得到 2 秒媒体；媒体时长不等同于墙钟时间。
    // 延长录制，仍严格检查原始视频能提供完整采样窗口，不补帧掩盖缺失。
    await delay(8000);
  } finally {
    child.kill('SIGINT');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000);
    const result = await closed;
    clearTimeout(timeout);
    if (result.signal === 'SIGKILL') throw new Error('模拟器录屏停止超时。');
    if (result.code && result.code !== 130) throw new Error(`模拟器录屏失败：${stderr}`);
  }
  // 取启动后 0.5～3.5 秒的六帧，保留原始录屏供人工回看。
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video,
    '-ss', '0.5', '-t', '3', '-vf', 'fps=2', join(directory, 'frame-%02d.png')], { timeout: 60_000 });
  const frames = readdirSync(directory).filter(name => /^frame-\d+\.png$/.test(name)).sort();
  if (frames.length !== 6) throw new Error(`动画采样不完整：预期 6 帧，实际 ${frames.length}。`);
  return frames;
}
