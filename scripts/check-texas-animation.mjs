import { ESLint } from 'eslint';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { texasAnimationFiles, texasAnimationTools } from '../quality/texas-animation-scope.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function lintTexasAnimation(directory = root) {
  const eslint = new ESLint({ cwd: directory, overrideConfigFile: resolve(root, 'eslint.config.mjs') });
  return eslint.lintFiles([...texasAnimationFiles, ...texasAnimationTools]);
}
export async function checkTexasAnimation(directory = root) {
  const results = await lintTexasAnimation(directory);
  const formatter = await new ESLint().loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) console.log(output);
  if (results.some(result => result.errorCount + result.warningCount > 0)) throw new Error('德州动画复杂度门禁失败');
  console.log(`德州动画复杂度门禁通过：${results.length} 个文件（测试及辅助 3，工具/根配置 6）`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await checkTexasAnimation(process.argv[2]);
}
