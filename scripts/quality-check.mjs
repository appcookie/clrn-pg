import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const inventoryPath = 'quality/legacy.json';
const ignored = new Set(['node_modules', '.git', '.cache', '.venv', '.appium', '__pycache__',
  'artifacts', 'playwright-report', 'test-results']);
const jsPattern = /\.(?:[cm]?[jt]s|[jt]sx)$/;
export const digest = text => createHash('sha256').update(text).digest('hex');
export function sourceFiles(directory = root, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    const name = join(prefix, entry.name);
    if (entry.isDirectory()) return ignored.has(entry.name) ? [] : sourceFiles(directory, name);
    return entry.isFile() && /\.(?:[cm]?[jt]s|[jt]sx|py)$/.test(name) ? [name] : [];
  }).sort();
}

function run(command, args, cwd, allowedStatuses = [0, 1]) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (!allowedStatuses.includes(result.status)) throw new Error(`${command}: ${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}
function location(tool, file, message, directory) {
  const line = message.line;
  const anchor = readFileSync(join(directory, file), 'utf8').split('\n')[line - 1].trim();
  return { tool, file, line, column: message.column, rule: message.rule, message: message.message, anchor: digest(anchor) };
}
export async function collectEslint(directory = root) {
  const eslint = new ESLint({ cwd: directory, overrideConfigFile: join(root, 'eslint.config.mjs') });
  const files = sourceFiles(directory).filter(file => jsPattern.test(file));
  const results = await eslint.lintFiles(files);
  const findings = results.flatMap(result => result.messages.map(message => {
    if (message.fatal || !message.ruleId) throw new Error(`${result.filePath}: ${message.message}`);
    return location('eslint', relative(directory, result.filePath), {
      ...message, rule: message.ruleId,
    }, directory);
  }));
  return { findings, measuredFiles: results.length };
}
export function collectRuff(directory = root, python = join(root, 'e2e/.venv/bin/python')) {
  directory = realpathSync(directory);
  const files = sourceFiles(directory).filter(file => file.endsWith('.py'));
  const results = run(python, ['-m', 'ruff', 'check', '--config', join(root, 'ruff.toml'),
    '--ignore-noqa', '--no-cache', '--output-format', 'json', ...files], directory);
  if (results.some(message => message.code !== 'C901')) throw new Error(`Python 解析失败：${JSON.stringify(results)}`);
  const findings = results.map(message => location('ruff', relative(directory, message.filename), {
    line: message.location.row, column: message.location.column, rule: message.code, message: message.message,
  }, directory));
  return { findings, measuredFiles: files.length };
}
export function collectDependencies(directory = root) {
  const files = sourceFiles(directory).filter(file => jsPattern.test(file));
  const report = run(process.execPath, [join(root, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs'),
    '--config', join(root, '.dependency-cruiser.cjs'), '--output-type', 'json', ...files], directory, [0, 3]);
  const findings = report.summary.violations.map(({ rule, from, to, cycle }) => ({
    tool: 'dependencies', rule: rule.name, from, to, ...(cycle ? { cycle } : {}),
  }));
  return { findings, measuredFiles: report.summary.totalCruised };
}
export function collectDuplicates(directory = root) {
  directory = realpathSync(directory);
  const files = sourceFiles(directory);
  for (const file of files) {
    if (/jscpd\s*:\s*ignore-(?:start|end)/i.test(readFileSync(join(directory, file), 'utf8'))) {
      throw new Error(`禁止使用重复检查忽略指令：${file}`);
    }
  }
  const output = mkdtempSync(join(tmpdir(), 'clrn-quality-'));
  try {
    execFileSync(process.execPath, [join(root, 'node_modules/jscpd/run-jscpd.js'),
      '--config', join(root, '.jscpd.json'), '--workers', '1', '--silent', '--no-colors', '--absolute',
      '--output', output, ...files], { cwd: directory, stdio: 'pipe' });
    const report = JSON.parse(readFileSync(join(output, 'jscpd-report.json'), 'utf8'));
    const findings = report.duplicates.map(clone => ({
      tool: 'duplicates', rule: 'jscpd', format: clone.format,
      locations: [clone.firstFile, clone.secondFile].map(file => ({
        file: relative(directory, file.name), start: file.startLoc, end: file.endLoc,
      })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      tokens: clone.tokens, lines: clone.lines, fragment: digest(clone.fragment),
    }));
    return { findings, statistics: report.statistics };
  } finally { rmSync(output, { recursive: true, force: true }); }
}

export function identity(entry) {
  const { reason, ...finding } = entry;
  return JSON.stringify(finding);
}
export function compareInventory(findings, inventory) {
  const known = new Set(inventory.map(identity));
  const actual = new Set(findings.map(identity));
  return {
    added: findings.filter(entry => !known.has(identity(entry))),
    stale: inventory.filter(entry => !actual.has(identity(entry))),
  };
}
export function assertShrinking(current, previous) {
  const allowed = new Map();
  for (const entry of previous) allowed.set(identity(entry), (allowed.get(identity(entry)) || 0) + 1);
  for (const entry of current) {
    if (!entry.reason?.trim()) throw new Error('历史迁移清单每项必须注明原因');
    const remaining = allowed.get(identity(entry));
    if (!remaining) throw new Error(`历史迁移清单只能缩减：${identity(entry)}`);
    allowed.set(identity(entry), remaining - 1);
  }
}
function checkHistory(inventory) {
  // CI supplies the PR base / push parent SHA; local checks use the committed HEAD.
  const ref = process.env.QUALITY_BASE_SHA || 'HEAD';
  if (!/^(HEAD|[0-9a-f]{40})$/.test(ref)) throw new Error('QUALITY_BASE_SHA 必须为完整提交 SHA');
  execFileSync('git', ['cat-file', '-e', `${ref}^{commit}`], { cwd: root, stdio: 'pipe' });
  const previous = spawnSync('git', ['show', `${ref}:${inventoryPath}`], { cwd: root, encoding: 'utf8' });
  if (previous.status === 0) assertShrinking(inventory, JSON.parse(previous.stdout));
  else {
    // First introduction is reviewable against the issue's original source tree.
    const listing = execFileSync('git', ['ls-tree', '--name-only', ref, 'quality'], { cwd: root, encoding: 'utf8' });
    if (listing.trim()) throw new Error(`无法读取 ${ref}:${inventoryPath}`);
  }
}
const collectors = { eslint: collectEslint, ruff: collectRuff, dependencies: collectDependencies, duplicates: collectDuplicates };
export async function check(tools) {
  const inventory = JSON.parse(readFileSync(join(root, inventoryPath), 'utf8'));
  assertShrinking(inventory, inventory);
  checkHistory(inventory);
  let failed = false;
  for (const tool of tools) {
    const { findings, ...measurement } = await collectors[tool]();
    const comparison = compareInventory(findings, inventory.filter(entry => entry.tool === tool));
    console.log(`${tool}: ${JSON.stringify(measurement)}; 历史 ${findings.length} 项，新增 ${comparison.added.length}，已消除待移除 ${comparison.stale.length}`);
    for (const entry of comparison.added) console.error(`新增违规 ${identity(entry)}`);
    for (const entry of comparison.stale) console.error(`请从迁移清单移除 ${identity(entry)}`);
    failed ||= comparison.added.length > 0 || comparison.stale.length > 0;
  }
  if (failed) throw new Error('静态门禁失败；不得扩大历史迁移清单或禁用规则');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selected = process.argv.slice(2);
  if (!selected.length || selected.some(tool => !collectors[tool])) throw new Error('指定 eslint / ruff / dependencies / duplicates');
  await check(selected);
}
