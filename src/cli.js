#!/usr/bin/env node
import { add, CatalogError, check, context, list, show, skillsDir, template } from './catalog.js';

const help = `AssetCollector — passive workflow skill catalog

assetcollector list                         list available skills
assetcollector search <text>                find skills by name, description or body
assetcollector show <name>                  read a skill and its canonical location
assetcollector add <skill-directory>        import a skill folder with its resources
assetcollector check [name]                 report document issues; never execute skills
assetcollector template <name> --description <text>
                                           print an authoring template to stdout
assetcollector context                      print agent integration instructions

Options: --skills-dir <dir>, --json
Catalog: --skills-dir > ASSETCOLLECTOR_SKILLS_DIR > this project's skills/
Edit registered skills directly at the canonical paths returned by show.
`;

const raw = process.argv.slice(2);
const json = raw.includes('--json');
let command = 'help';
try {
  const positional = [];
  const opts = new Map();
  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg === '--') { positional.push(...raw.slice(i + 1)); break; }
    if (arg === '--json') continue;
    if (arg === '--help' || arg === '-h') { positional.unshift('help'); continue; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (!['--skills-dir', '--description'].includes(arg)) throw new CatalogError('invalid_argument', `Unknown option ${arg}`);
    const value = raw[++i];
    if (!value || value.startsWith('--') || opts.has(arg)) throw new CatalogError('invalid_argument', `${arg} requires one value and cannot be repeated.`);
    opts.set(arg, value);
  }
  command = positional.shift() ?? 'help';
  const root = skillsDir(opts.get('--skills-dir'));
  if (opts.has('--description') && command !== 'template') throw new CatalogError('invalid_argument', '--description is only for template.');
  const arities = { help: [0, 0], list: [0, 0], search: [1, 1], show: [1, 1], add: [1, 1], check: [0, 1], template: [1, 1], context: [0, 0] };
  const arity = Object.hasOwn(arities, command) ? arities[command] : undefined;
  if (!arity || positional.length < arity[0] || positional.length > arity[1]) throw new CatalogError('invalid_argument', `Invalid command or arguments. Run assetcollector help.`);
  let data;
  switch (command) {
    case 'help': data = { text: help }; break;
    case 'list': data = list(root); break;
    case 'search': data = list(root, positional[0]); break;
    case 'show': data = show(root, positional[0]); break;
    case 'add': data = add(root, positional[0]); break;
    case 'check': data = check(root, positional[0]); if (data.findings.length) process.exitCode = 1; break;
    case 'template': data = { text: template(positional[0], opts.get('--description')) }; break;
    case 'context': data = context(root); break;
  }
  if (json) console.log(JSON.stringify({ schemaVersion: 1, command, generatedAt: new Date().toISOString(), data, errors: [] }, null, 2));
  else if (data.text !== undefined) process.stdout.write(data.text);
  else if (data.content !== undefined) {
    console.log(`${data.file}\n\n${data.content}`);
    for (const f of data.findings) console.log(`[${f.code}] ${f.message}`);
  } else {
    if (data.skills) {
      if (!data.skills.length) console.log('No matching skills.');
      for (const skill of data.skills) console.log(`${skill.name}\t${skill.description}\n  ${skill.file}`);
    } else console.log(`Checked ${data.checked} skill(s).`);
    for (const f of data.findings) console.log(`${f.name} [${f.code}] ${f.message}`);
  }
} catch (error) {
  process.exitCode = 1;
  const problem = { code: error instanceof CatalogError ? error.code : 'io_error', message: error.message };
  if (json) console.log(JSON.stringify({ schemaVersion: 1, command, generatedAt: new Date().toISOString(), data: null, errors: [problem] }, null, 2));
  else console.error(`${problem.code}: ${problem.message}`);
}
