import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { add, addNamespace, check, defaultDataDir, list, migrateLegacyRepoSkills, projectDir, readSkill, resolveCatalog, show, template } from '../src/catalog.js';

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
  assert.equal(cli(root, 'show', 'missing/skill').errors[0].code, 'not_found');
  assert.equal(existsSync(root), false);
});

test('default catalog is XDG data, not the git repository', () => {
  const resolved = resolveCatalog(undefined, {});
  assert.equal(resolved.source, 'xdg');
  assert.equal(resolved.root, defaultDataDir({}));
  assert.ok(!resolved.root.startsWith(projectDir));
  const fromEnv = resolveCatalog(undefined, { ASSETCOLLECTOR_SKILLS_DIR: '/tmp/collector-env' });
  assert.equal(fromEnv.source, 'env');
  const fromFlag = resolveCatalog('/tmp/collector-flag', { ASSETCOLLECTOR_SKILLS_DIR: '/tmp/collector-env' });
  assert.equal(fromFlag.source, 'flag');
});

test('import preserves resources, supports discovery, and never runs scripts', t => {
  const { base, root } = workspace(t);
  addNamespace(root, 'shared');
  const source = skill(base);
  mkdirSync(path.join(source, 'references'));
  mkdirSync(path.join(source, 'scripts'));
  writeFileSync(path.join(source, 'references/input.txt'), 'original evidence');
  const sentinel = path.join(base, 'unexpected-execution');
  writeFileSync(path.join(source, 'scripts/run.js'), `require('fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed')`);
  const registered = add(root, source, 'shared');
  assert.deepEqual(registered.findings, []);
  assert.equal(registered.id, 'shared/sample-workflow');
  assert.equal(readFileSync(path.join(registered.directory, 'references/input.txt'), 'utf8'), 'original evidence');
  assert.equal(list(root, '中文资料').skills[0].id, 'shared/sample-workflow');
  assert.equal(list(root, 'SELECTED SOURCE').skills.length, 1);
  assert.equal(list(root, 'absent words').skills.length, 0);
  assert.deepEqual(check(root), { checked: 1, findings: [] });
  assert.equal(existsSync(sentinel), false);
  assert.equal(existsSync(path.join(root, 'index.json')), false);
});

test('canonical edits are immediately visible; imports never overwrite', t => {
  const { base, root } = workspace(t);
  addNamespace(root, 'shared');
  const source = skill(base);
  const original = add(root, source, 'shared');
  assert.throws(() => add(root, source, 'shared'), { code: 'already_exists' });
  writeFileSync(original.file, original.content.replace('Reusable source review.', 'Revised manual workflow.'));
  assert.equal(list(root, 'Revised manual').skills.length, 1);
  assert.match(show(root, original.id).description, /Revised/);
  assert.match(readFileSync(path.join(source, 'SKILL.md'), 'utf8'), /Reusable/);
});

test('document issues are reported without becoming an import gate', t => {
  const { base, root } = workspace(t);
  addNamespace(root, 'shared');
  const source = skill(base, 'draft-flow', '## Steps\n\nTODO: choose the steps.\n');
  const added = add(root, source, 'shared');
  assert.deepEqual(added.findings.map(f => f.code), ['missing_checks', 'unfinished_template']);
  assert.equal(list(root).skills.length, 1);
  const result = cli(root, 'check', 'shared/draft-flow');
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
  addNamespace(root, 'shared');
  add(root, skill(base), 'shared');
  const malformed = skill(path.join(root, 'shared'), 'bad-yaml');
  writeFileSync(path.join(malformed, 'SKILL.md'), '---\nname: broken\nname: duplicate\ndescription: test\n---\n');
  const mismatch = skill(path.join(root, 'shared'), 'mismatch');
  writeFileSync(path.join(mismatch, 'SKILL.md'), readFileSync(path.join(mismatch, 'SKILL.md'), 'utf8').replace('name: mismatch', 'name: another'));
  const result = list(root);
  assert.equal(result.skills.length, 1);
  assert.ok(result.findings.some(f => f.code === 'invalid_skill'));
  assert.ok(result.findings.some(f => f.code === 'name_mismatch'));
  assert.equal(check(root).checked, 3);
  assert.equal(cli(root, 'show', 'shared/mismatch').errors[0].code, 'name_mismatch');
});

test('invalid names, symlinks, and self-containing imports cannot escape the catalog', t => {
  const { base, root } = workspace(t);
  addNamespace(root, 'shared');
  assert.throws(() => show(root, '../outside'), { code: 'invalid_name' });
  const source = skill(base);
  symlinkSync('/tmp', path.join(source, 'outside'));
  assert.throws(() => add(root, source, 'shared'), { code: 'invalid_entry' });
  rmSync(path.join(source, 'outside'));
  const nested = path.join(source, 'nested');
  addNamespace(nested, 'shared');
  assert.throws(() => add(nested, source, 'shared'), { code: 'invalid_argument' });
  assert.equal(existsSync(path.join(nested, 'shared', 'sample-workflow')), false);
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

test('CLI supports namespaced lifecycle, status, and structured failures', t => {
  const { base, root } = workspace(t);
  const source = skill(base);
  assert.equal(cli(root, 'namespace', 'add', 'shared').status, 0);
  assert.equal(cli(root, 'add', source).errors[0].code, 'invalid_argument');
  assert.equal(cli(root, 'add', source, '--namespace', 'shared').status, 0);
  assert.equal(cli(root, 'search', 'source review').data.skills[0].id, 'shared/sample-workflow');
  assert.equal(cli(root, 'show', 'shared/sample-workflow').data.name, 'sample-workflow');
  assert.equal(cli(root, 'check').status, 0);
  const snapshot = cli(root, 'status');
  assert.equal(snapshot.status, 0);
  assert.equal(snapshot.data.source, 'flag');
  assert.equal(snapshot.data.skills, 1);
  assert.equal(snapshot.data.namespaces[0].id, 'shared');
  assert.equal(cli(root, 'run', 'sample-workflow').errors[0].code, 'invalid_argument');
  assert.equal(cli(root, 'constructor').errors[0].code, 'invalid_argument');
  assert.equal(cli(root, 'list', '--unknown').errors[0].code, 'invalid_argument');
  assert.equal(cli(root, 'search').errors[0].code, 'invalid_argument');
  assert.deepEqual(readdirSync(root).filter(name => !name.startsWith('.')), ['shared']);
});

test('legacy repo skills copy into shared and tukahu namespaces', t => {
  const { base, root } = workspace(t);
  const legacy = path.join(base, 'skills');
  mkdirSync(path.join(legacy, 'thematic-collection'), { recursive: true });
  writeFileSync(path.join(legacy, 'thematic-collection', 'SKILL.md'), '---\nname: thematic-collection\ndescription: Collect sources.\n---\n\n## 检查\n\n- [ ] Saved in the project namespace.\n');
  mkdirSync(path.join(legacy, 'tukahu-blog-publish'), { recursive: true });
  writeFileSync(path.join(legacy, 'tukahu-blog-publish', 'SKILL.md'), '---\nname: tukahu-blog-publish\ndescription: Publish the blog.\n---\n\n## 检查\n\n- [ ] Production sitemap matches local dist.\n');
  const result = migrateLegacyRepoSkills(root, legacy);
  assert.deepEqual(result.copied.map(item => item.to).sort(), ['shared/thematic-collection', 'tukahu/blog-publish']);
  assert.equal(show(root, 'tukahu/blog-publish').name, 'blog-publish');
  assert.equal(migrateLegacyRepoSkills(root, legacy).copied.length, 0);
});
