// Read-only measurements; reports go to stdout, never rewrite the inventory.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { sourceFiles, collectEslint, collectRuff, collectDependencies, collectDuplicates } from './quality-check.mjs';

const directory = resolve(process.argv[2] || '.');
const files = sourceFiles(directory);
const eslint = new ESLint({ cwd: directory, overrideConfigFile: resolve('eslint.config.mjs'),
  overrideConfig: { rules: { complexity: ['error', 0], 'max-depth': ['error', 0] } } });
const jsResults = await eslint.lintFiles(files.filter(file => !file.endsWith('.py')));
if (jsResults.some(result => result.fatalErrorCount)) throw new Error('JS/TS 存在解析错误');
const jsMessages = jsResults.flatMap(result => result.messages);
const complexity = jsMessages.filter(message => message.ruleId === 'complexity').map(message => Number(message.message.match(/complexity of (\d+)/)[1]));
const depth = jsMessages.filter(message => message.ruleId === 'max-depth').map(message => Number(message.message.match(/deeply \((\d+)\)/)[1]));
let pythonOutput;
try {
  pythonOutput = execFileSync(resolve('e2e/.venv/bin/python'), ['-m', 'ruff', 'check', '--config', resolve('ruff.toml'),
    '--config', 'lint.mccabe.max-complexity=0', '--ignore-noqa', '--no-cache', '--output-format', 'json',
    ...files.filter(file => file.endsWith('.py'))], { cwd: directory, encoding: 'utf8' });
} catch (error) {
  if (error.status !== 1) throw error;
  pythonOutput = error.stdout;
}
const pythonMessages = JSON.parse(pythonOutput);
if (pythonMessages.some(message => message.code !== 'C901')) throw new Error('Python 存在解析错误');
const pythonComplexity = pythonMessages.map(message => Number(message.message.match(/\((\d+) > 0\)/)[1]));
const summarize = (values, limit) => ({ count: values.length, maximum: Math.max(0, ...values), aboveLimit: values.filter(value => value > limit).length });
const eslintReport = await collectEslint(directory);
const duplicates = collectDuplicates(directory);
const report = {
  versions: Object.fromEntries(['eslint', '@typescript-eslint/parser', 'dependency-cruiser', 'jscpd'].map(name =>
    [name, JSON.parse(readFileSync(resolve('node_modules', name, 'package.json'), 'utf8')).version])),
  ruff: execFileSync(resolve('e2e/.venv/bin/python'), ['-m', 'ruff', '--version'], { encoding: 'utf8' }).trim(),
  files: { js: jsResults.length, python: files.filter(file => file.endsWith('.py')).length },
  jsComplexity: summarize(complexity, 10), jsDepthBlocks: summarize(depth, 3), pythonComplexity: summarize(pythonComplexity, 10),
  networkFabrication: eslintReport.findings.filter(entry => entry.rule === 'architecture/no-network-fabrication'),
  pythonViolations: collectRuff(directory).findings,
  architecture: collectDependencies(directory),
  duplication: duplicates,
};
console.log(JSON.stringify(report, null, 2));
