// 动画结束后的独立截图沿用静态截图规则；录屏轨迹和中间相位继续使用各自的严格断言。
import { comparePixels } from '../visual.mjs';

export function compareAnimationEndpoint(actual: Buffer, references: { name: string; bytes: Buffer }[]) {
  if (!references.length) throw new Error('动画终点必须有已审查基准');
  const results = references.map(reference => ({ name: reference.name,
    ...comparePixels(reference.bytes, actual, 12) }));
  const selected = results.find(result => result.matches)
    ?? results.reduce((best, result) => result.changedRatio < best.changedRatio ? result : best);
  return { matches: selected.matches, diff: selected.diff,
    comparisons: results.map(({ name, matches, changedRatio, reason }) => ({ name, matches, changedRatio, reason })) };
}
