import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

export const projectDir = fileURLToPath(new URL('../', import.meta.url));
export const formatFile = path.join(projectDir, 'docs', 'SKILL-FORMAT.md');
export const DEFAULT_WEB_PORT = 4125;
export const NS_PATTERN = /^[a-z][a-z0-9-]*$/;
const RESERVED_NS = new Set(['schemas']);
const LEGACY_SKILL_MAP = new Map([
  ['thematic-collection', { namespace: 'shared', name: 'thematic-collection' }],
  ['tukahu-topic-research', { namespace: 'tukahu', name: 'topic-research' }],
  ['tukahu-editorial-article', { namespace: 'tukahu', name: 'editorial-article' }],
  ['tukahu-blog-publish', { namespace: 'tukahu', name: 'blog-publish' }],
]);

export class CatalogError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function defaultDataDir(env = process.env) {
  return env.XDG_DATA_HOME
    ? path.join(env.XDG_DATA_HOME, 'assetcollector')
    : path.join(homedir(), '.local', 'share', 'assetcollector');
}

export function resolveCatalog(explicit, env = process.env) {
  if (explicit) return { root: path.resolve(explicit), source: 'flag' };
  if (env.ASSETCOLLECTOR_SKILLS_DIR) return { root: path.resolve(env.ASSETCOLLECTOR_SKILLS_DIR), source: 'env' };
  return { root: path.resolve(defaultDataDir(env)), source: 'xdg' };
}

export function skillsDir(explicit, env = process.env) {
  return resolveCatalog(explicit, env).root;
}

export function validName(name) {
  if (typeof name !== 'string' || name.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new CatalogError('invalid_name', 'Skill names must be 1–63 lowercase letters, digits and single hyphens.');
  }
  return name;
}

export function validNamespace(id) {
  if (typeof id !== 'string' || !NS_PATTERN.test(id) || RESERVED_NS.has(id)) {
    throw new CatalogError('invalid_name', `Namespace ids must match ${NS_PATTERN} and cannot be reserved.`);
  }
  return id;
}

export function parseQualified(value) {
  if (typeof value !== 'string' || !value.includes('/')) {
    throw new CatalogError('invalid_name', "Use namespace/skill, for example 'tukahu/editorial-article'.");
  }
  const parts = value.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new CatalogError('invalid_name', "Use namespace/skill, for example 'tukahu/editorial-article'.");
  }
  return { namespace: validNamespace(parts[0]), name: validName(parts[1]) };
}

function nsDir(root, id) {
  return path.join(root, id);
}

function nsMetaPath(root, id) {
  return path.join(root, id, '.ns.json');
}

function isDotName(name) {
  return name.startsWith('.');
}

function plainBody(body) {
  const lines = [];
  let fence = null;
  for (const line of body.split('\n')) {
    const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (match) {
      if (!fence) fence = match[1];
      else if (match[1][0] === fence[0] && match[1].length >= fence.length) fence = null;
      continue;
    }
    if (!fence) lines.push(line);
  }
  return lines.join('\n');
}

export function readSkill(directory) {
  const file = path.join(directory, 'SKILL.md');
  let content;
  try { content = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'); }
  catch { throw new CatalogError('unreadable_skill', `Cannot read ${file}`); }
  const match = content.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/);
  if (!match) throw new CatalogError('invalid_skill', `${file}: expected YAML frontmatter.`);
  const doc = parseDocument(match[1], { uniqueKeys: true });
  if (doc.errors.length) throw new CatalogError('invalid_skill', `${file}: ${doc.errors[0].message}`);
  let metadata;
  try { metadata = doc.toJS({ maxAliasCount: 100 }); }
  catch { throw new CatalogError('invalid_skill', `${file}: cannot resolve YAML metadata.`); }
  validName(metadata?.name);
  if (typeof metadata.description !== 'string' || !metadata.description.trim()) {
    throw new CatalogError('invalid_skill', `${file}: description must be a non-empty string.`);
  }
  const findings = [];
  const body = plainBody(match[2]);
  const sections = body.match(/^(#{1,6})[ \t]+(?:检查|验证|检查清单|Checks|Validation|Verification|Checklist)[ \t]*#*[ \t]*\n([\s\S]*?)(?=^#{1,6}[ \t]+|$(?![\s\S]))/gim) ?? [];
  const hasCheck = sections.some(section => section.split('\n').some(line => {
    const item = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/);
    return item && item[1].replace(/^\[[ xX]\]\s*/, '').trim().length > 0;
  }));
  if (!hasCheck) {
    findings.push({ code: 'missing_checks', message: 'Add a 检查 / Checks section listing the checks the executing agent should perform.' });
  }
  if (/\bTODO\b|\[INSERT[^\]]*\]/i.test(match[2])) {
    findings.push({ code: 'unfinished_template', message: 'Replace unfinished template instructions before using this workflow.' });
  }
  if (!match[2].trim()) findings.push({ code: 'empty_body', message: 'The skill has no workflow instructions.' });
  return { name: metadata.name, description: metadata.description.trim(), file: path.resolve(file), directory: path.resolve(directory), content, findings };
}

function summary(skill, namespace) {
  return {
    namespace,
    name: skill.name,
    id: `${namespace}/${skill.name}`,
    description: skill.description,
    file: skill.file,
    findings: skill.findings,
  };
}

function readNsMeta(root, id) {
  const file = nsMetaPath(root, id);
  if (!existsSync(file)) return { name: id, created_at: null };
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return { name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id, created_at: raw.created_at ?? null };
  } catch {
    return { name: id, created_at: null };
  }
}

function listNsIds(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !isDotName(entry.name) && !RESERVED_NS.has(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function skillDirs(root, namespace) {
  const dir = nsDir(root, namespace);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !isDotName(entry.name))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export function listNamespaces(root) {
  const findings = [];
  const namespaces = [];
  if (!existsSync(root)) return { namespaces, findings };
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (isDotName(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (!entry.isDirectory()) {
      findings.push({ name: entry.name, code: 'legacy_entry', message: 'Catalog root may only contain namespace directories.' });
      continue;
    }
    if (existsSync(path.join(full, 'SKILL.md'))) {
      findings.push({ name: entry.name, code: 'legacy_layout', message: `Skill '${entry.name}' sits at the catalog root. Move it under a namespace.` });
      continue;
    }
    if (RESERVED_NS.has(entry.name)) continue;
    try { validNamespace(entry.name); }
    catch (error) {
      findings.push({ name: entry.name, code: error.code ?? 'invalid_name', message: error.message });
      continue;
    }
    const meta = readNsMeta(root, entry.name);
    namespaces.push({
      id: entry.name,
      name: meta.name,
      created_at: meta.created_at,
      skills: skillDirs(root, entry.name).length,
      path: path.resolve(full),
    });
  }
  return { namespaces, findings };
}

export function addNamespace(root, id, options = {}) {
  validNamespace(id);
  const dir = nsDir(root, id);
  if (existsSync(dir)) throw new CatalogError('already_exists', `Namespace '${id}' exists at ${dir}.`);
  mkdirSync(dir, { recursive: true });
  const meta = { name: options.name?.trim() || id, created_at: new Date().toISOString() };
  writeFileSync(nsMetaPath(root, id), `${JSON.stringify(meta, null, 2)}\n`);
  return showNamespace(root, id);
}

export function showNamespace(root, id) {
  validNamespace(id);
  const dir = nsDir(root, id);
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) throw new CatalogError('not_found', `No namespace named '${id}'.`);
  const meta = readNsMeta(root, id);
  const names = skillDirs(root, id);
  return { id, name: meta.name, created_at: meta.created_at, skills: names.length, path: path.resolve(dir), skillNames: names };
}

function requireNamespace(root, id) {
  validNamespace(id);
  const dir = nsDir(root, id);
  if (!existsSync(dir) || !lstatSync(dir).isDirectory() || existsSync(path.join(dir, 'SKILL.md'))) {
    throw new CatalogError('not_found', `No namespace named '${id}'. Create it with: assetcollector namespace add ${id}`);
  }
  return dir;
}

export function list(root, query = '', namespace) {
  const findings = [];
  const skills = [];
  const catalog = listNamespaces(root);
  findings.push(...catalog.findings);
  const needle = query.toLocaleLowerCase();
  const ids = namespace ? [requireNamespace(root, namespace) && namespace] : catalog.namespaces.map(n => n.id);
  for (const ns of ids) {
    for (const name of skillDirs(root, ns)) {
      try {
        const skill = readSkill(path.join(root, ns, name));
        if (skill.name !== name) throw new CatalogError('name_mismatch', 'Folder name and frontmatter name must match.');
        findings.push(...skill.findings.map(f => ({ name: `${ns}/${name}`, ...f })));
        const blob = `${skill.name}\n${ns}\n${skill.description}\n${skill.content}`.toLocaleLowerCase();
        if (!needle || blob.includes(needle)) skills.push(summary(skill, ns));
      } catch (error) {
        findings.push({ name: `${ns}/${name}`, code: error.code ?? 'invalid_skill', message: error.message });
      }
    }
  }
  return { skills, findings };
}

function regularTree(directory) {
  if (!lstatSync(directory).isDirectory()) throw new CatalogError('invalid_entry', 'Import a regular directory, not a symlink or file.');
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) regularTree(target);
    else if (!entry.isFile()) throw new CatalogError('invalid_entry', `Import supports regular files and directories only: ${target}`);
  }
}

function canonicalPath(target) {
  const absolute = path.resolve(target);
  if (existsSync(absolute)) return realpathSync(absolute);
  return path.join(canonicalPath(path.dirname(absolute)), path.basename(absolute));
}

export function show(root, qualified) {
  const { namespace, name } = parseQualified(qualified);
  requireNamespace(root, namespace);
  const dir = path.join(root, namespace, name);
  if (!existsSync(dir)) throw new CatalogError('not_found', `No skill named '${namespace}/${name}'.`);
  if (!lstatSync(dir).isDirectory()) throw new CatalogError('invalid_entry', `Not a regular skill directory: ${dir}`);
  const skill = readSkill(dir);
  if (skill.name !== name) throw new CatalogError('name_mismatch', 'Folder name and frontmatter name must match.');
  return { ...skill, namespace, id: `${namespace}/${name}` };
}

export function add(root, source, namespace) {
  if (!namespace) throw new CatalogError('invalid_argument', 'add requires --namespace <id>.');
  const nsRoot = requireNamespace(root, namespace);
  const directory = path.resolve(source);
  if (!existsSync(directory)) throw new CatalogError('not_found', `No directory at ${directory}`);
  regularTree(directory);
  const skill = readSkill(directory);
  const target = path.join(nsRoot, skill.name);
  if (existsSync(target)) throw new CatalogError('already_exists', `Skill '${namespace}/${skill.name}' exists. Edit its canonical files at ${target}.`);
  const relative = path.relative(realpathSync(directory), canonicalPath(root));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new CatalogError('invalid_argument', 'The catalog must not be inside the imported skill directory.');
  }
  mkdirSync(nsRoot, { recursive: true });
  const stage = mkdtempSync(path.join(nsRoot, '.import-'));
  try {
    cpSync(directory, stage, { recursive: true, errorOnExist: false });
    renameSync(stage, target);
  } finally { rmSync(stage, { recursive: true, force: true }); }
  return show(root, `${namespace}/${skill.name}`);
}

export function check(root, qualified, namespace) {
  if (qualified) {
    const skill = show(root, qualified);
    return { checked: 1, findings: skill.findings.map(f => ({ name: skill.id, ...f })) };
  }
  const catalog = list(root, '', namespace);
  const names = new Set([...catalog.skills.map(s => s.id), ...catalog.findings.map(f => f.name)]);
  return { checked: names.size, findings: catalog.findings };
}

export function template(name, description) {
  validName(name);
  if (typeof description !== 'string' || !description.trim()) throw new CatalogError('invalid_argument', '--description is required.');
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n## 输入\n\nTODO: 说明适用任务、输入、约束及必要的工具或数据位置。\n\n## 步骤\n\nTODO: 写出值得复用的步骤，把临场判断留给执行 agent。\n\n## 输出\n\nTODO: 说明交付物、保存位置和未完成事项如何报告。\n\n## 检查\n\n- [ ] TODO: 列出实际需要验证的结果，以及无法验证时如何说明。\n`;
}

function rewriteFrontmatterName(content, name) {
  return content.replace(/^name:[ \t]*.*$/m, `name: ${name}`);
}

function mapLegacySkill(folder) {
  if (LEGACY_SKILL_MAP.has(folder)) return LEGACY_SKILL_MAP.get(folder);
  if (folder.startsWith('tukahu-')) return { namespace: 'tukahu', name: folder.slice('tukahu-'.length) };
  return { namespace: 'shared', name: folder };
}

export function migrateLegacyRepoSkills(root, legacyRoot = path.join(projectDir, 'skills')) {
  const copied = [];
  if (!existsSync(legacyRoot)) return { copied, from: legacyRoot };
  if (list(root).skills.length > 0) return { copied, from: legacyRoot };
  for (const entry of readdirSync(legacyRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || isDotName(entry.name)) continue;
    const source = path.join(legacyRoot, entry.name);
    if (!existsSync(path.join(source, 'SKILL.md'))) continue;
    const mapped = mapLegacySkill(entry.name);
    try { validNamespace(mapped.namespace); validName(mapped.name); }
    catch { continue; }
    if (!existsSync(nsDir(root, mapped.namespace))) addNamespace(root, mapped.namespace);
    const target = path.join(root, mapped.namespace, mapped.name);
    if (existsSync(target)) continue;
    mkdirSync(path.dirname(target), { recursive: true });
    const stage = mkdtempSync(path.join(path.dirname(target), '.import-'));
    try {
      cpSync(source, stage, { recursive: true, errorOnExist: false });
      const skillFile = path.join(stage, 'SKILL.md');
      writeFileSync(skillFile, rewriteFrontmatterName(readFileSync(skillFile, 'utf8'), mapped.name));
      renameSync(stage, target);
      copied.push({ from: entry.name, to: `${mapped.namespace}/${mapped.name}` });
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  return { copied, from: legacyRoot };
}

export function status(root, source, env = process.env, extra = {}) {
  const catalog = listNamespaces(root);
  const listed = list(root);
  return {
    root: path.resolve(root),
    source,
    env: {
      ASSETCOLLECTOR_SKILLS_DIR: env.ASSETCOLLECTOR_SKILLS_DIR ?? null,
      XDG_DATA_HOME: env.XDG_DATA_HOME ?? null,
    },
    webPort: DEFAULT_WEB_PORT,
    formatFile,
    namespaces: catalog.namespaces.map(n => ({ id: n.id, name: n.name, skills: n.skills })),
    skills: listed.skills.length,
    findings: [...catalog.findings, ...listed.findings.filter(f => f.code === 'legacy_layout' || f.code === 'legacy_entry')],
    migrated: extra.migrated ?? null,
  };
}

export function context(root) {
  return { text: `# AssetCollector\n\nA passive catalog of reusable workflow skills. It never calls APIs, runs skill scripts, schedules jobs, or stores collected data.\n\nCatalog: ${root}\nLayout: <catalog>/<namespace>/<skill>/SKILL.md\nFormat: ${formatFile}\nInspect the live install with: assetcollector status --json\n\nBefore repeating a workflow, run assetcollector search <task words> --json. Read a match with assetcollector show <namespace>/<skill> --json, then follow its SKILL.md and relevant local references as the executing agent.\nIf there is no match, do the task using available tools. When the user chooses to save a workflow, use assetcollector template <name> --description <description>, finish the instructions, then assetcollector namespace add <id> (if needed) and assetcollector add <skill-directory> --namespace <id>. The imported directory becomes the canonical copy; edit that copy for later changes.\nRun assetcollector check [namespace/skill] to report missing checklists or unfinished instructions. This checks the document, not task results; the executing agent reports what was checked, failed or left unverified.\n\nGeneric workflows live in the shared namespace. Project workflows use the same namespace id as AssetHub (for example tukahu). Tool capabilities and credentials: AgentPulse. Collected content: AssetHub.\n` };
}
