import http from 'node:http';
import { list, parseQualified, show } from './catalog.js';

const escape = (value) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const css = `
:root{color-scheme:light;--bg:#faf9f7;--ink:#1b1d20;--mut:#626970;--line:#e8e5df;--accent:#0f766e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}main{max-width:880px;margin:auto;padding:32px 24px 72px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:32px}a{color:var(--accent);text-underline-offset:4px}header a{text-decoration:none;font-weight:650;color:var(--ink)}header span,.muted{color:var(--mut)}h1{font-size:26px;line-height:1.35;letter-spacing:-.5px;margin:16px 0 10px;overflow-wrap:anywhere}h2{font-size:17px;margin:28px 0 12px}p{margin:8px 0 20px}form{margin:28px 0}label{display:block;margin-bottom:8px;font-weight:600}.search{display:flex;gap:8px}input,button{font:inherit;min-height:44px;border:1px solid #b9bebd;border-radius:5px;padding:9px 12px}input{min-width:0;flex:1;background:white}button{background:var(--accent);color:white;border-color:var(--accent);cursor:pointer}a:focus-visible,input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.rows{list-style:none;padding:0}.rows li{border-top:1px solid var(--line);padding:18px 0}.rows li:last-child{border-bottom:1px solid var(--line)}.rows a{font-weight:600;font-size:16px;overflow-wrap:anywhere}.rows p{margin:5px 0}.warning{border:1px solid #dec9a9;padding:10px 16px;background:#fbf2e3}.warning ul{padding-left:20px;margin:6px 0}.empty{padding:24px 0;border-top:1px solid var(--line)}dl{display:grid;grid-template-columns:100px minmax(0,1fr);gap:10px 16px;padding:18px 0;border-block:1px solid var(--line)}dt{color:var(--mut)}dd{margin:0;overflow-wrap:anywhere}code,pre{font:13px/1.8 ui-monospace,SFMono-Regular,Consolas,monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;background:white;border:1px solid var(--line);border-radius:6px}.path{overflow-wrap:anywhere}.path code{display:block}footer{margin-top:36px;color:var(--mut);font-size:13px}@media(max-width:520px){main{padding:24px 18px 48px}header{margin-bottom:24px}h1{font-size:23px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:10px}pre{padding:14px}}
`;
function page(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · AssetCollector</title><style>${css}</style></head><body><main><header><a href="/">AssetCollector</a><span>只读浏览</span></header>${body}<footer>内容来自本地流程目录。修改文件后刷新页面即可查看更新。</footer></main></body></html>`;
}
function warnings(findings) {
  return findings.length ? `<aside class="warning" aria-label="文档检查提示"><strong>文档检查提示 · ${findings.length} 项</strong><ul>${findings.map(f => `<li>${f.name ? `${escape(f.name)}：` : ''}${escape(f.message)}</li>`).join('')}</ul></aside>` : '';
}
function hrefFor(skill) {
  return `/n/${encodeURIComponent(skill.namespace)}/${encodeURIComponent(skill.name)}`;
}
function index(root, query) {
  const catalog = list(root, query);
  return page('流程库', `<h1>流程库</h1><p class="muted">查看已登记流程的说明、原文和文档检查提示。</p><form action="/" method="get" role="search"><label for="q">搜索流程</label><div class="search"><input id="q" name="q" type="search" placeholder="名称、说明或正文" value="${escape(query)}"><button type="submit">搜索</button></div></form><p class="muted">${query ? '匹配' : '已登记'} ${catalog.skills.length} 个流程${query ? ' · <a href="/">查看全部</a>' : ''}</p>${warnings(catalog.findings)}${catalog.skills.length ? `<ul class="rows">${catalog.skills.map(s => `<li><a href="${hrefFor(s)}">${escape(s.id)}</a><p>${escape(s.description)}</p><small class="muted">${s.findings.length ? `${s.findings.length} 项文档提示` : '文档检查：未发现问题'}</small></li>`).join('')}</ul>` : `<div class="empty"><h2>${query ? '没有匹配的流程' : '还没有登记流程'}</h2><p>${query ? '尝试其他关键词，或查看全部流程。' : '通过 CLI 登记已有流程后，这里就会显示。'}</p>${query ? '' : '<code>assetcollector add &lt;流程目录&gt; --namespace &lt;id&gt;</code>'}</div>`}<p class="muted path">目录：<code>${escape(root)}</code></p>`);
}
function detail(root, qualified) {
  const skill = show(root, qualified);
  return page(skill.id, `<a href="/">← 返回流程库</a><h1>${escape(skill.id)}</h1><p>${escape(skill.description)}</p><dl><dt>命名空间</dt><dd><code>${escape(skill.namespace)}</code></dd><dt>文件位置</dt><dd><code>${escape(skill.file)}</code></dd><dt>文档检查</dt><dd>${skill.findings.length ? `${skill.findings.length} 项提示` : '未发现问题'}（仅检查文档格式）</dd></dl>${warnings(skill.findings)}<h2>流程原文</h2><pre>${escape(skill.content)}</pre>`);
}

/** Serves only catalog views. No resources, write endpoints or execution hooks. */
export async function startServer(root, port = 4125) {
  const server = http.createServer((req, res) => {
    let status = 200;
    let body;
    const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" };
    try {
      if (!['GET', 'HEAD'].includes(req.method)) {
        status = 405; headers.Allow = 'GET, HEAD'; body = page('只读页面', '<h1>仅支持浏览</h1><a href="/">返回流程库</a>');
      } else {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/') body = index(root, url.searchParams.get('q') ?? '');
        else {
          const match = /^\/n\/([^/]+)\/([^/]+)$/.exec(url.pathname);
          if (!match) status = 404;
          else {
            const qualified = `${decodeURIComponent(match[1])}/${decodeURIComponent(match[2])}`;
            parseQualified(qualified);
            body = detail(root, qualified);
          }
        }
      }
    } catch {
      status = 404;
    }
    if (status === 404) body = page('未找到', '<h1>未找到</h1><p>没有这个流程，或路径无效。</p><a href="/">返回流程库</a>');
    res.writeHead(status, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise((resolve, reject) => {
    server.listen(port, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  return server;
}
