import { assertVisual, simulatorAppPath } from './device';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { ScreenshotBounds } from './screenshot';
import { baselinePath } from './baseline-path.mjs';

/** Reference pixels come from the downloaded .app image, never application source. */
export function launchArtworkTemplate(application: string, width: number, height: number): PNG {
  return PNG.sync.read(execFileSync('ffmpeg', ['-v', 'error', '-i',
    path.join(application, 'assets/src/launch/assets/launch-background-phone.jpg'),
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 32 * 1024 * 1024, timeout: 30000 }));
}

/** Match the actual spatial artwork, allowing the staging dialog's uniform dimming layer. */
export function launchArtworkMatch(picture: PNG, reference: PNG, occlusions: ScreenshotBounds[]) {
  if (picture.width !== reference.width || picture.height !== reference.height) throw new Error('启动插画参考尺寸不一致');
  const samples: { actual: number[]; expected: number[] }[] = [];
  const stride = Math.max(1, Math.ceil(picture.width / 64));
  for (let y = stride; y < picture.height; y += stride) for (let x = stride; x < picture.width; x += stride) {
    if (occlusions.some(box => x >= box.x - 6 && y >= box.y - 6
      && x < box.x + box.width + 6 && y < box.y + box.height + 6)) continue;
    const offset = (y * picture.width + x) * 4;
    samples.push({ actual: [...picture.data.subarray(offset, offset + 3)], expected: [...reference.data.subarray(offset, offset + 3)] });
  }
  if (samples.length < 128) throw new Error('启动插画未遮挡的像素不足，不能验证真实素材');
  const means = (key: 'actual' | 'expected') => [0, 1, 2].map(channel =>
    samples.reduce((sum, sample) => sum + sample[key][channel], 0) / samples.length);
  const actualMean = means('actual'), expectedMean = means('expected');
  let expectedVariance = 0, actualVariance = 0, covariance = 0;
  for (const sample of samples) for (let channel = 0; channel < 3; channel++) {
    const actual = sample.actual[channel] - actualMean[channel];
    const expected = sample.expected[channel] - expectedMean[channel];
    expectedVariance += expected * expected; actualVariance += actual * actual; covariance += actual * expected;
  }
  const gain = covariance / expectedVariance;
  const correlation = covariance / Math.sqrt(expectedVariance * actualVariance);
  const rmse = Math.sqrt(Math.max(0, actualVariance - covariance * covariance / expectedVariance) / (samples.length * 3));
  // Black/white/system splash or a similarly coloured gradient has no matching forest,
  // clouds and water texture. Uniform dimming may change colour but cannot move them.
  const matches = Number.isFinite(correlation) && correlation > 0.98 && rmse < 5 && gain >= 0.3 && gain <= 1.1;
  return { matches, samples: samples.length, correlation, rmse, gain };
}

/** A reviewed clear frame and a later uniformly dimmed staging frame share the
 * same forest/water pixels outside the native dialog and status bars. */
export function reviewedLaunchArtworkMatch(picture: PNG, reviewed: PNG, occlusions: ScreenshotBounds[]) {
  const spatial = launchArtworkMatch(picture, reviewed, occlusions);
  return { ...spatial, matches: spatial.matches && spatial.correlation >= 0.995
    && spatial.rmse <= 2.5 && spatial.gain >= 0.45 };
}

/** Verify the rendered iOS artwork behind the staging dialog, not Android colour coordinates. */
export async function verifyLaunchArtwork(frames: Buffer[], testInfo: TestInfo,
  occlusions: ScreenshotBounds[]): Promise<void> {
  const full = PNG.sync.read(frames[0]);
  const reference = launchArtworkTemplate(await simulatorAppPath(), full.width, full.height);
  // The system status/home indicators are not part of the app artwork. These narrow
  // edges were measured in the iPhone 16 CI recording; dialog/brand use native bounds.
  const exclusions = [...occlusions,
    { x: 0, y: 0, width: full.width, height: Math.ceil(full.height * 0.08) },
    { x: 0, y: Math.floor(full.height * 0.96), width: full.width, height: Math.ceil(full.height * 0.04) }];
  const metrics = frames.map(frame => launchArtworkMatch(PNG.sync.read(frame), reference, exclusions));
  await testInfo.attach('native-launch-artwork-matches', { body: JSON.stringify(metrics), contentType: 'application/json' });
  const candidates = frames.filter((_, index) => metrics[index].matches);
  expect(candidates.length, '真实启动帧必须呈现应用森林、云层及水波插画，不能用系统启动页代替').toBeGreaterThan(0);
  const first = candidates[0], name = 'native-launch-artwork-visible.png';
  await testInfo.attach(name, { body: first, contentType: 'image/png' });
  if (process.env.IOS_VISUAL_MODE !== 'compare') await assertVisual(first, name, testInfo);
  else {
    const baseline = PNG.sync.read(readFileSync(baselinePath(name)));
    const reviewed = candidates.map(candidate => reviewedLaunchArtworkMatch(PNG.sync.read(candidate), baseline, exclusions));
    await testInfo.attach('native-launch-artwork-baseline-matches', {
      body: JSON.stringify(reviewed), contentType: 'application/json',
    });
    expect(reviewed.some(result => result.matches),
      `${name} 须在无遮挡森林与水波区域匹配已审查的插画`).toBe(true);
  }
}
