import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

export const projectDir = fileURLToPath(new URL('../', import.meta.url));
export const formatFile = path.join(projectDir, 'docs', 'SKILL-FORMAT.md');

export class CatalogError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function skillsDir(explicit) {
  return path.resolve(explicit ?? process.env.ASSETCOLLECTOR_SKILLS_DIR ?? path.join(projectDir, 'skills'));
}

export function validName(name) {
  if (typeof name !== 'string' || name.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new CatalogError('invalid_name', 'Skill names must be 1–63 lowercase letters, digits and single hyphens.');
  }
  return name;
}

function plainBody(body) {
  // A heading shown inside a code example is not a check section.
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

function summary(skill) {
  return { name: skill.name, description: skill.description, file: skill.file, findings: skill.findings };
}

export function list(root, query = '') {
  if (!existsSync(root)) return { skills: [], findings: [] };
  const skills = [];
  const findings = [];
  const needle = query.toLocaleLowerCase();
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    try {
      if (!entry.isDirectory()) throw new CatalogError('invalid_entry', 'Catalog entries must be regular skill directories.');
      const skill = readSkill(path.join(root, entry.name));
      if (skill.name !== entry.name) throw new CatalogError('name_mismatch', 'Folder name and frontmatter name must match.');
      findings.push(...skill.findings.map(f => ({ name: entry.name, ...f })));
      if (!needle || `${skill.name}\n${skill.description}\n${skill.content}`.toLocaleLowerCase().includes(needle)) skills.push(summary(skill));
    } catch (error) {
      findings.push({ name: entry.name, code: error.code ?? 'invalid_skill', message: error.message });
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

export function show(root, name) {
  validName(name);
  const dir = path.join(root, name);
  if (!existsSync(dir)) throw new CatalogError('not_found', `No skill named '${name}'.`);
  if (!lstatSync(dir).isDirectory()) throw new CatalogError('invalid_entry', `Not a regular skill directory: ${dir}`);
  const skill = readSkill(dir);
  if (skill.name !== name) throw new CatalogError('name_mismatch', 'Folder name and frontmatter name must match.');
  return skill;
}

export function add(root, source) {
  const directory = path.resolve(source);
  if (!existsSync(directory)) throw new CatalogError('not_found', `No directory at ${directory}`);
  regularTree(directory);
  const skill = readSkill(directory);
  const target = path.join(root, skill.name);
  if (existsSync(target)) throw new CatalogError('already_exists', `Skill '${skill.name}' exists. Edit its canonical files at ${target}.`);
  // Prevent recursive copying if the catalog is inside the imported directory.
  const relative = path.relative(realpathSync(directory), canonicalPath(root));
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new CatalogError('invalid_argument', 'The catalog must not be inside the imported skill directory.');
  }
  mkdirSync(root, { recursive: true });
  const stage = mkdtempSync(path.join(root, '.import-'));
  try {
    cpSync(directory, stage, { recursive: true, errorOnExist: false });
    renameSync(stage, target);
  } finally { rmSync(stage, { recursive: true, force: true }); }
  return show(root, skill.name);
}

export function check(root, name) {
  if (name !== undefined) {
    const skill = show(root, name);
    return { checked: 1, findings: skill.findings.map(f => ({ name, ...f })) };
  }
  const catalog = list(root);
  const names = new Set([...catalog.skills.map(s => s.name), ...catalog.findings.map(f => f.name)]);
  return { checked: names.size, findings: catalog.findings };
}

export function template(name, description) {
  validName(name);
  if (typeof description !== 'string' || !description.trim()) throw new CatalogError('invalid_argument', '--description is required.');
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description.trim())}\n---\n\n## 输入\n\nTODO: 说明适用任务、输入、约束及必要的工具或数据位置。\n\n## 步骤\n\nTODO: 写出值得复用的步骤，把临场判断留给执行 agent。\n\n## 输出\n\nTODO: 说明交付物、保存位置和未完成事项如何报告。\n\n## 检查\n\n- [ ] TODO: 列出实际需要验证的结果，以及无法验证时如何说明。\n`;
}

export function context(root) {
  return { text: `# AssetCollector\n\nA passive catalog of reusable workflow skills. It never calls APIs, runs skill scripts, schedules jobs, or stores collected data.\n\nCatalog: ${root}\nFormat: ${formatFile}\n\nBefore repeating a workflow, run assetcollector search <task words> --json. Read a match with assetcollector show <name> --json, then follow its SKILL.md and relevant local references as the executing agent.\nIf there is no match, do the task using available tools. When the user chooses to save a workflow, use assetcollector template <name> --description <description>, finish the instructions, then assetcollector add <skill-directory>. The imported directory becomes the canonical copy; edit that copy for later changes.\nRun assetcollector check [name] to report missing checklists or unfinished instructions. This checks the document, not task results; the executing agent reports what was checked, failed or left unverified.\n\nTool capabilities and credentials: AgentPulse. Collected content, source records and demand records: AssetHub. Business workflows are created by the user in the context of their task.\n` };
}
