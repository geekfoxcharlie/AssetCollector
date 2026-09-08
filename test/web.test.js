import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { startServer } from '../src/web.js';

async function setup(t) {
  const base = mkdtempSync(path.join(tmpdir(), 'collector-web-'));
  const root = path.join(base, 'skills');
  const server = await startServer(root, 0);
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(base, { recursive: true, force: true }); });
  return { root, get: (route = '/', options) => fetch(`http://127.0.0.1:${server.address().port}${route}`, options) };
}

test('empty catalog is readable without creating directories; HTTP is read-only', async t => {
  const { root, get } = await setup(t);
  assert.match(await (await get()).text(), /还没有登记流程/);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const response = await get('/', { method, body: 'ignored' });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
  assert.equal(await (await get('/', { method: 'HEAD' })).text(), '');
  assert.equal(existsSync(root), false);
});

test('list, search and detail escape content and reflect edits without executing resources', async t => {
  const { root, get } = await setup(t);
  const dir = path.join(root, 'example');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  const content = '---\nname: example\ndescription: 写作技巧\n---\n<script>alert(1)</script>\n## 检查\n- 核对来源\n';
  writeFileSync(file, content);
  writeFileSync(path.join(dir, 'run.js'), 'throw new Error("must not execute")');
  const index = await get();
  assert.match(index.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(await index.text(), /href="\/skills\/example"/);
  const detail = await (await get('/skills/example')).text();
  assert.match(detail, /&lt;script&gt;/);
  assert.doesNotMatch(detail, /<script>/);
  assert.match(await (await get('/?q=missing')).text(), /没有匹配的流程/);
  assert.match(await (await get('/?q=' + encodeURIComponent('写作'))).text(), /href="\/skills\/example"/);
  for (const route of ['/skills/example/run.js', '/skills/%2e%2e%2fsecret', '/skills/missing', '/src/web.js']) assert.equal((await get(route)).status, 404);
  assert.equal(readFileSync(file, 'utf8'), content);
  writeFileSync(file, content.replace('写作技巧', '更新后的说明'));
  assert.match(await (await get()).text(), /更新后的说明/);
  mkdirSync(path.join(root, 'broken'));
  writeFileSync(path.join(root, 'broken', 'SKILL.md'), 'invalid');
  const broken = await (await get()).text();
  assert.match(broken, /文档检查提示/);
  assert.match(broken, /href="\/skills\/example"/);
});

test('CLI rejects invalid ports and JSON mode for the server', () => {
  for (const args of [['web', '--port', '0'], ['web', '--port', '65536'], ['web', '--port', 'abc'], ['web', '--json'], ['list', '--port', '4125']]) {
    const result = spawnSync(process.execPath, ['src/cli.js', ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.match(result.stdout + result.stderr, /invalid_argument/);
  }
});
