#!/usr/bin/env node
import { add, addNamespace, CatalogError, check, context, list, listNamespaces, migrateLegacyRepoSkills, resolveCatalog, show, showNamespace, status, template } from './catalog.js';
import { startServer } from './web.js';

const help = `AssetCollector — passive workflow skill catalog

assetcollector list [--namespace <id>]      list skills
assetcollector search <text> [--namespace <id>]
                                           find skills by name, description or body
assetcollector show <namespace>/<skill>     read a skill and its canonical location
assetcollector add <skill-directory> --namespace <id>
                                           import a skill folder with its resources
assetcollector check [<namespace>/<skill>] [--namespace <id>]
                                           report document issues; never execute skills
assetcollector namespace add <id> [--name <n>]
assetcollector namespace list
assetcollector namespace show <id>
assetcollector template <name> --description <text>
                                           print an authoring template to stdout
assetcollector context                      print agent integration instructions
assetcollector status                       print resolved catalog paths and counts
assetcollector web [--port 4125]             browse the read-only local web interface

Options: --skills-dir <dir>, --namespace <id>, --json
Catalog: --skills-dir > ASSETCOLLECTOR_SKILLS_DIR > $XDG_DATA_HOME/assetcollector > ~/.local/share/assetcollector
Layout: <catalog>/<namespace>/<skill>/SKILL.md
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
    if (!['--skills-dir', '--description', '--port', '--namespace', '--name'].includes(arg)) throw new CatalogError('invalid_argument', `Unknown option ${arg}`);
    const value = raw[++i];
    if (!value || value.startsWith('--') || opts.has(arg)) throw new CatalogError('invalid_argument', `${arg} requires one value and cannot be repeated.`);
    opts.set(arg, value);
  }
  command = positional.shift() ?? 'help';
  const resolved = resolveCatalog(opts.get('--skills-dir'));
  const root = resolved.root;
  let migrated = null;
  if (resolved.source === 'xdg') {
    const result = migrateLegacyRepoSkills(root);
    if (result.copied.length) migrated = result;
  }
  if (opts.has('--description') && command !== 'template') throw new CatalogError('invalid_argument', '--description is only for template.');
  if (opts.has('--port') && command !== 'web') throw new CatalogError('invalid_argument', '--port is only for web.');
  if (opts.has('--name') && !(command === 'namespace' && positional[0] === 'add')) throw new CatalogError('invalid_argument', '--name is only for namespace add.');
  if (command === 'web' && json) throw new CatalogError('invalid_argument', 'web does not support --json.');
  if (opts.has('--namespace') && !['list', 'search', 'add', 'check'].includes(command)) {
    throw new CatalogError('invalid_argument', '--namespace is only for list, search, add and check.');
  }
  const port = opts.get('--port') ?? '4125';
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new CatalogError('invalid_argument', '--port must be an integer from 1 to 65535.');
  const arities = {
    help: [0, 0], list: [0, 0], search: [1, 1], show: [1, 1], add: [1, 1], check: [0, 1],
    template: [1, 1], context: [0, 0], status: [0, 0], web: [0, 0], namespace: [1, 2],
  };
  const arity = Object.hasOwn(arities, command) ? arities[command] : undefined;
  if (!arity || positional.length < arity[0] || positional.length > arity[1]) throw new CatalogError('invalid_argument', `Invalid command or arguments. Run assetcollector help.`);
  let data;
  switch (command) {
    case 'help': data = { text: help }; break;
    case 'list': data = list(root, '', opts.get('--namespace')); break;
    case 'search': data = list(root, positional[0], opts.get('--namespace')); break;
    case 'show': data = show(root, positional[0]); break;
    case 'add': data = add(root, positional[0], opts.get('--namespace')); break;
    case 'check': data = check(root, positional[0], opts.get('--namespace')); if (data.findings.length) process.exitCode = 1; break;
    case 'template': data = { text: template(positional[0], opts.get('--description')) }; break;
    case 'context': data = context(root); break;
    case 'status': data = status(root, resolved.source, process.env, { migrated }); break;
    case 'namespace': {
      const sub = positional[0];
      if (sub === 'add') {
        if (positional.length !== 2) throw new CatalogError('invalid_argument', 'namespace add <id>');
        data = addNamespace(root, positional[1], { name: opts.get('--name') });
        command = 'namespace add';
      } else if (sub === 'list') {
        if (positional.length !== 1) throw new CatalogError('invalid_argument', 'namespace list');
        data = listNamespaces(root);
        command = 'namespace list';
      } else if (sub === 'show') {
        if (positional.length !== 2) throw new CatalogError('invalid_argument', 'namespace show <id>');
        data = showNamespace(root, positional[1]);
        command = 'namespace show';
      } else {
        throw new CatalogError('invalid_argument', 'unknown namespace subcommand (add | list | show)');
      }
      break;
    }
    case 'web': {
      const server = await startServer(root, Number(port));
      data = { text: `AssetCollector: http://127.0.0.1:${server.address().port}\nRead-only catalog: ${root}\nPress Ctrl+C to stop.\n` };
      break;
    }
  }
  if (json) console.log(JSON.stringify({ schemaVersion: 1, command, generatedAt: new Date().toISOString(), data, errors: [] }, null, 2));
  else if (data.text !== undefined) process.stdout.write(data.text);
  else if (data.content !== undefined) {
    console.log(`${data.id ?? data.name}\n${data.file}\n\n${data.content}`);
    for (const f of data.findings) console.log(`[${f.code}] ${f.message}`);
  } else if (command === 'namespace add' || command === 'namespace show') {
    console.log(`id        ${data.id}`);
    console.log(`name      ${data.name}`);
    console.log(`skills    ${data.skills}`);
    console.log(`path      ${data.path}`);
  } else if (command === 'namespace list') {
    if (!data.namespaces.length) console.log('No namespaces (create one with: assetcollector namespace add <id>)');
    for (const n of data.namespaces) console.log(`${n.id.padEnd(20)}${String(n.skills).padStart(4)}  ${n.name}`);
    for (const f of data.findings) console.log(`${f.name} [${f.code}] ${f.message}`);
  } else if (command === 'status') {
    console.log(`root       ${data.root}`);
    console.log(`source     ${data.source}`);
    console.log(`web        http://127.0.0.1:${data.webPort}`);
    console.log(`skills     ${data.skills}`);
    if (!data.namespaces.length) console.log('namespaces (none)');
    for (const n of data.namespaces) console.log(`  ${n.id.padEnd(18)}${String(n.skills).padStart(4)}  ${n.name}`);
    if (data.migrated?.copied?.length) {
      console.log(`migrated   from ${data.migrated.from}`);
      for (const item of data.migrated.copied) console.log(`  ${item.from} → ${item.to}`);
    }
    for (const f of data.findings) console.log(`${f.name} [${f.code}] ${f.message}`);
  } else {
    if (data.skills) {
      if (!data.skills.length) console.log('No matching skills.');
      for (const skill of data.skills) console.log(`${skill.id}\t${skill.description}\n  ${skill.file}`);
    } else console.log(`Checked ${data.checked} skill(s).`);
    for (const f of data.findings) console.log(`${f.name} [${f.code}] ${f.message}`);
  }
} catch (error) {
  process.exitCode = 1;
  const problem = { code: error instanceof CatalogError ? error.code : 'io_error', message: error.message };
  if (json) console.log(JSON.stringify({ schemaVersion: 1, command, generatedAt: new Date().toISOString(), data: null, errors: [problem] }, null, 2));
  else console.error(`${problem.code}: ${problem.message}`);
}
