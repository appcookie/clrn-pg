import { PNG } from 'pngjs';
import type { ScreenshotBounds } from './screenshot';

/** 只测已与发布包森林背景空间匹配的帧；每帧先消除统一遮罩的 gain/offset。 */
export function brandFadeEvidence(frames: Buffer[], finalFrame: Buffer, reference: PNG,
  region: ScreenshotBounds, exclusions: ScreenshotBounds[]) {
  const final = PNG.sync.read(finalFrame);
  const { x, y, width, height } = region;
  if (![x, y, width, height].every(Number.isInteger)
    || x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > final.width || y + height > final.height) {
    throw new Error('品牌区域必须是截图范围内的非空整数像素矩形');
  }

  const stride = Math.max(2, Math.ceil(final.width / 64));
  const masked = [region, ...exclusions];
  const points: number[] = [];
  for (let sampleY = stride; sampleY < final.height; sampleY += stride) {
    for (let sampleX = stride; sampleX < final.width; sampleX += stride) {
      const excluded = masked.some(bounds => sampleX >= bounds.x - 4 && sampleY >= bounds.y - 4
        && sampleX < bounds.x + bounds.width + 4 && sampleY < bounds.y + bounds.height + 4);
      if (!excluded) points.push((sampleY * final.width + sampleX) * 4);
    }
  }
  if (points.length < 128) throw new Error('可见启动背景不足，不能区分品牌与系统转场');

  function fit(picture: PNG) {
    if (picture.width !== reference.width || picture.height !== reference.height) {
      throw new Error('品牌参考图与录屏尺寸不一致');
    }
    const means = (image: PNG) => [0, 1, 2].map(channel =>
      points.reduce((sum, offset) => sum + image.data[offset + channel], 0) / points.length);
    const actualMeans = means(picture);
    const referenceMeans = means(reference);
    let referenceVariance = 0;
    let actualVariance = 0;
    let covariance = 0;
    for (const offset of points) {
      for (let channel = 0; channel < 3; channel++) {
        const expected = reference.data[offset + channel] - referenceMeans[channel];
        const actual = picture.data[offset + channel] - actualMeans[channel];
        referenceVariance += expected * expected;
        actualVariance += actual * actual;
        covariance += expected * actual;
      }
    }
    const gain = covariance / referenceVariance;
    const correlation = covariance / Math.sqrt(referenceVariance * actualVariance);
    const error = Math.sqrt(Math.max(0, actualVariance - covariance * covariance / referenceVariance)
      / (points.length * 3));
    const offsets = actualMeans.map((value, channel) => value - gain * referenceMeans[channel]);
    const valid = Number.isFinite(correlation) && correlation > 0.98 && error < 5
      && gain >= 0.3 && gain <= 1.1;
    return { gain, correlation, error, offsets, valid };
  }

  const end = fit(final);
  if (!end.valid) throw new Error('品牌终态尚未显示真实发布包启动背景');
  const channels: number[] = [];
  const target: number[] = [];
  for (let pixelY = y; pixelY < y + height; pixelY++) {
    for (let pixelX = x; pixelX < x + width; pixelX++) {
      for (let channel = 0; channel < 3; channel++) {
        const offset = (pixelY * final.width + pixelX) * 4 + channel;
        const value = (final.data[offset] - end.offsets[channel]) / end.gain - reference.data[offset];
        if (value > 24) {
          channels.push(offset);
          target.push(value);
        }
      }
    }
  }
  if (channels.length < width * height * 0.03) throw new Error('终态品牌区域缺少足够文字像素');
  const denominator = target.reduce((sum, value) => sum + value * value, 0);
  const samples = frames.map((bytes, index) => {
    const picture = PNG.sync.read(bytes);
    const background = fit(picture);
    if (!background.valid) return { index, background, alpha: null, residual: null };
    const ink = channels.map(offset =>
      (picture.data[offset] - background.offsets[offset % 4]) / background.gain - reference.data[offset]);
    const alpha = ink.reduce((sum, value, channel) => sum + value * target[channel], 0) / denominator;
    const residual = Math.sqrt(ink.reduce((sum, value, channel) =>
      sum + (value - alpha * target[channel]) ** 2, 0) / ink.length);
    return { index, background, alpha, residual };
  });

  const valid = samples.filter(sample => sample.alpha !== null && sample.residual !== null && sample.residual < 12);
  const start = valid.find(sample => sample.alpha! >= -0.1 && sample.alpha! < 0.15);
  const middle = start && valid.find(sample => sample.index > start.index && sample.alpha! > 0.2 && sample.alpha! < 0.6);
  const later = middle && valid.find(sample => sample.index > middle.index
    && sample.alpha! > middle.alpha! + 0.2 && sample.alpha! < 0.9);
  const endPhase = later && valid.find(sample => sample.index > later.index && sample.alpha! >= 0.95 && sample.alpha! <= 1.1);
  return {
    samples,
    start: start?.index,
    middle: middle?.index,
    later: later?.index,
    end: endPhase?.index,
    complete: !!start && !!middle && !!later && !!endPhase,
  };
}
