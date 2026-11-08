// Read-only per-function classic ESLint measurements, including nested callbacks.
import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import { dirname, matchesGlob, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { texasAnimationFiles, texasAnimationTools } from '../quality/texas-animation-scope.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scope = [...texasAnimationFiles, ...texasAnimationTools];
const eslint = new ESLint({ cwd: root, overrideConfigFile: resolve(root, 'eslint.config.mjs'),
  overrideConfig: { rules: { complexity: ['error', { max: 0, variant: 'classic' }] } } });
function functionMeasurements(file, result) {
  if (result.fatalErrorCount) throw new Error(`${file}: ${JSON.stringify(result.messages)}`);
  return result.messages.filter(message => message.ruleId === 'complexity').map(message => ({
    file, line: message.line, column: message.column, function: message.message.replace(/ has a complexity of .*$/, ''),
    complexity: Number(message.message.match(/complexity of (\d+)/)[1]), limit: texasAnimationTools.includes(file) ? 6 : 3,
  }));
}
async function measure(sources) {
  const report = [];
  for (const [file, source] of sources) {
    const [result] = await eslint.lintText(source, { filePath: resolve(root, file) });
    report.push(...functionMeasurements(file, result));
  }
  return report;
}
function previousSources(ref) {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  return files.filter(file => scope.some(pattern => matchesGlob(file, pattern)))
    .map(file => [file, execFileSync('git', ['show', `${ref}:${file}`], { cwd: root, encoding: 'utf8' })]);
}
const files = [...new Set(scope.flatMap(pattern => globSync(pattern, { cwd: root })))].sort();
if (!files.length) throw new Error('德州动画测量范围为空');
const beforeRef = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(beforeRef)) throw new Error('指定重构前的完整提交 SHA');
console.log(JSON.stringify({ algorithm: 'ESLint classic (defaults, optional chains and short circuits included)',
  beforeRef, before: await measure(previousSources(beforeRef)),
  after: await measure(files.map(file => [file, readFileSync(resolve(root, file), 'utf8')])) }, null, 2));
