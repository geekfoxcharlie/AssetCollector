import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { add, check, list, projectDir, readSkill, show, template } from '../src/catalog.js';

function workspace(t) {
  const base = mkdtempSync(path.join(tmpdir(), 'assetcollector-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, root: path.join(base, 'catalog') };
}
function skill(base, name = 'sample-workflow', body = '## Steps\n\nRead the selected source.\n\n## Checks\n\n- [ ] Verify the result against the source.\n') {
  const dir = path.join(base, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: |\n  Reusable source review.\n  Supports 中文资料.\n---\n\n${body}`);
  return dir;
}
function cli(root, ...args) {
  const processResult = spawnSync(process.execPath, [path.join(projectDir, 'src/cli.js'), ...args, '--skills-dir', root, '--json'], { encoding: 'utf8' });
  return { status: processResult.status, ...JSON.parse(processResult.stdout) };
}

test('empty reads have no side effects and distinguish absent skills', t => {
  const { root } = workspace(t);
  assert.deepEqual(list(root), { skills: [], findings: [] });
  assert.deepEqual(check(root), { checked: 0, findings: [] });
  assert.equal(cli(root, 'list').status, 0);
  assert.equal(cli(root, 'show', 'missing').errors[0].code, 'not_found');
  assert.equal(existsSync(root), false);
});

test('import preserves resources, supports discovery, and never runs scripts', t => {
  const { base, root } = workspace(t);
  const source = skill(base);
  mkdirSync(path.join(source, 'references'));
  mkdirSync(path.join(source, 'scripts'));
  writeFileSync(path.join(source, 'references/input.txt'), 'original evidence');
  const sentinel = path.join(base, 'unexpected-execution');
  writeFileSync(path.join(source, 'scripts/run.js'), `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed')`);
  const registered = add(root, source);
  assert.deepEqual(registered.findings, []);
  assert.equal(readFileSync(path.join(registered.directory, 'references/input.txt'), 'utf8'), 'original evidence');
  assert.equal(list(root, '中文资料').skills[0].name, 'sample-workflow');
  assert.equal(list(root, 'SELECTED SOURCE').skills.length, 1);
  assert.equal(list(root, 'absent words').skills.length, 0);
  assert.deepEqual(check(root), { checked: 1, findings: [] });
  assert.equal(existsSync(sentinel), false);
  assert.equal(existsSync(path.join(root, 'index.json')), false);
});

test('canonical edits are immediately visible; imports never overwrite', t => {
  const { base, root } = workspace(t);
  const source = skill(base);
  const original = add(root, source);
  assert.throws(() => add(root, source), { code: 'already_exists' });
  writeFileSync(original.file, original.content.replace('Reusable source review.', 'Revised manual workflow.'));
  assert.equal(list(root, 'Revised manual').skills.length, 1);
  assert.match(show(root, original.name).description, /Revised/);
  assert.match(readFileSync(path.join(source, 'SKILL.md'), 'utf8'), /Reusable/);
});

test('document issues are reported without becoming an import gate', t => {
  const { base, root } = workspace(t);
  const source = skill(base, 'draft-flow', '## Steps\n\nTODO: choose the steps.\n');
  const added = add(root, source);
  assert.deepEqual(added.findings.map(f => f.code), ['missing_checks', 'unfinished_template']);
  assert.equal(list(root).skills.length, 1);
  const result = cli(root, 'check', 'draft-flow');
  assert.equal(result.status, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.data.findings.length, 2);
});

test('checklists support Chinese and reject headings appearing only in code', t => {
  const { base } = workspace(t);
  const chinese = skill(base, 'chinese-flow', '## 检查\n\n- 已读取实际输出并与输入核对。\n');
  assert.deepEqual(readSkill(chinese).findings, []);
  const example = skill(base, 'code-only', '```md\n## Checks\n- verify\n```\n');
  assert.ok(readSkill(example).findings.some(f => f.code === 'missing_checks'));
  const empty = skill(base, 'empty-checks', '## 检查\n\n以后再检查。\n');
  assert.ok(readSkill(empty).findings.some(f => f.code === 'missing_checks'));
  const emptyBox = skill(base, 'empty-box', '## 检查\n\n- [ ]\n- [x]   \n');
  assert.ok(readSkill(emptyBox).findings.some(f => f.code === 'missing_checks'));
});

test('malformed YAML and folder mismatches remain visible without breaking the catalog', t => {
  const { base, root } = workspace(t);
  add(root, skill(base));
  const malformed = skill(root, 'bad-yaml');
  writeFileSync(path.join(malformed, 'SKILL.md'), '---\nname: broken\nname: duplicate\ndescription: test\n---\n');
  const mismatch = skill(root, 'mismatch');
  writeFileSync(path.join(mismatch, 'SKILL.md'), readFileSync(path.join(mismatch, 'SKILL.md'), 'utf8').replace('name: mismatch', 'name: another'));
  const result = list(root);
  assert.equal(result.skills.length, 1);
  assert.ok(result.findings.some(f => f.code === 'invalid_skill'));
  assert.ok(result.findings.some(f => f.code === 'name_mismatch'));
  assert.equal(check(root).checked, 3);
  assert.equal(cli(root, 'show', 'mismatch').errors[0].code, 'name_mismatch');
});

test('invalid names, symlinks, and self-containing imports cannot escape the catalog', t => {
  const { base, root } = workspace(t);
  assert.throws(() => show(root, '../outside'), { code: 'invalid_name' });
  const source = skill(base);
  symlinkSync('/tmp', path.join(source, 'outside'));
  assert.throws(() => add(root, source), { code: 'invalid_entry' });
  assert.equal(existsSync(root), false);
  rmSync(path.join(source, 'outside'));
  assert.throws(() => add(path.join(source, 'nested'), source), { code: 'invalid_argument' });
  assert.equal(existsSync(path.join(source, 'nested')), false);
});

test('template and context explain authoring without creating a business skill', t => {
  const { base, root } = workspace(t);
  const draft = skill(base, 'new-flow');
  writeFileSync(path.join(draft, 'SKILL.md'), template('new-flow', 'Use for a "quoted" task: with punctuation.'));
  assert.equal(readSkill(draft).description, 'Use for a "quoted" task: with punctuation.');
  assert.ok(readSkill(draft).findings.some(f => f.code === 'unfinished_template'));
  const result = cli(root, 'context');
  assert.equal(result.status, 0);
  assert.ok(result.data.text.includes(root));
  assert.equal(existsSync(root), false);
});

test('CLI supports the complete lifecycle and structured failures', t => {
  const { base, root } = workspace(t);
  const source = skill(base);
  assert.equal(cli(root, 'add', source).status, 0);
  assert.equal(cli(root, 'search', 'source review').data.skills.length, 1);
  assert.equal(cli(root, 'show', 'sample-workflow').data.name, 'sample-workflow');
  assert.equal(cli(root, 'check').status, 0);
  assert.equal(cli(root, 'run', 'sample-workflow').errors[0].code, 'invalid_argument');
  assert.equal(cli(root, 'constructor').errors[0].code, 'invalid_argument');
  assert.equal(cli(root, 'list', '--unknown').errors[0].code, 'invalid_argument');
  assert.equal(cli(root, 'search').errors[0].code, 'invalid_argument');
  assert.deepEqual(readdirSync(root), ['sample-workflow']);
});
