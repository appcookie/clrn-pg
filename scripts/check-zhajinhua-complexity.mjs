import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testFiles, toolFiles } from './zhajinhua-complexity-scope.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// No legacy inventory is consulted: this scope must be clean independently.
export async function checkZhajinhuaComplexity(directory = root) {
  const eslint = new ESLint({ cwd: directory, overrideConfigFile: resolve(root, 'eslint.config.mjs'),
    errorOnUnmatchedPattern: false });
  const results = await eslint.lintFiles([...testFiles, ...toolFiles]);
  if (!results.length) throw new Error('拼三张复杂度检查没有扫描到文件');
  const formatter = await eslint.loadFormatter('stylish');
  if (results.some(result => result.errorCount + result.warningCount > 0))
    throw new Error(formatter.format(results));
  return results.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`拼三张静态检查通过：${await checkZhajinhuaComplexity(process.argv[2])} 个文件（测试/辅助 ≤3，工具/根配置 ≤6）`);
}
