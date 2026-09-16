import http from 'node:http';
import { list, parseQualified, show } from './catalog.js';

const escape = (value) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const MARK = `<svg class="mark" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="3.2"/><rect x="3" y="10.4" width="13.5" height="3.2"/><rect x="3" y="16.3" width="8.5" height="3.2"/></svg>`;

const css = `
:root{
  --paper:#ece6d8; --sheet:#f7f3ea; --ink:#1c1712; --mut:#6a5e52; --faint:#94867a;
  --line:#d9d0c0; --accent:#b5441f; --accent-soft:#f3ddd4; --seal:#b5441f;
  --display:"Iowan Old Style","Palatino Linotype","Palatino","Songti SC","STSong",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --radius:3px;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--sans);min-height:100vh}
::selection{background:var(--accent-soft)}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
a{color:var(--accent)}
.frame{max-width:820px;margin:0 auto;padding:28px 28px 80px}
header.bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-bottom:20px;border-bottom:1px solid var(--line);margin-bottom:32px}
.brand{display:flex;align-items:center;gap:10px;font-family:var(--display);font-size:22px;font-weight:600;letter-spacing:-.02em;text-decoration:none;color:var(--ink)}
.brand .mark{width:22px;height:22px;fill:var(--accent)}
.brand small{font-family:var(--sans);font-size:12px;font-weight:500;color:var(--mut);margin-left:2px}
h1{font-family:var(--display);font-size:clamp(28px,4.4vw,42px);font-weight:600;letter-spacing:-.03em;line-height:1.15;margin:0 0 10px;overflow-wrap:anywhere}
.lede{margin:0 0 28px;color:var(--mut)}
form{margin:0 0 28px}
label{display:block;margin-bottom:8px;font-size:13px;font-weight:600;color:var(--mut)}
.search{display:flex;gap:8px}
input,button{font:inherit;min-height:44px;border:1px solid var(--line);border-radius:var(--radius);padding:9px 12px}
input{min-width:0;flex:1;background:var(--sheet);color:var(--ink)}
button{background:var(--ink);color:var(--sheet);border-color:var(--ink);cursor:pointer;font-weight:550}
button:hover{background:#2a231c}
.count{color:var(--mut);font-size:13px;margin:0 0 12px}
.rows{list-style:none;padding:0;margin:0}
.rows li{background:var(--sheet);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;margin:0 0 10px}
.rows a{font-family:var(--display);font-weight:600;font-size:20px;text-decoration:none;color:var(--ink);overflow-wrap:anywhere}
.rows a:hover{color:var(--accent)}
.rows p{margin:6px 0 8px;color:var(--mut)}
.rows small{color:var(--faint);font-size:12.5px}
.warning{background:var(--sheet);border:1px solid #e0c4a8;padding:12px 16px;margin:0 0 20px;border-radius:var(--radius)}
.warning strong{color:var(--seal)}
.warning ul{padding-left:20px;margin:8px 0 0}
.empty{padding:36px 8px;color:var(--mut)}
.empty h2{font-family:var(--display);font-size:26px;color:var(--ink);margin:0 0 8px}
.empty code{display:block;margin-top:12px;font:13px/1.7 var(--mono);background:var(--sheet);border:1px solid var(--line);padding:12px 14px;border-radius:var(--radius)}
.back{display:inline-block;margin-bottom:18px;color:var(--mut);text-decoration:none;font-size:13px}
.back:hover{color:var(--accent)}
.manuscript{background:var(--sheet);border:1px solid var(--line);border-radius:var(--radius);padding:28px 32px 36px;margin-top:8px}
dl{display:grid;grid-template-columns:108px minmax(0,1fr);gap:10px 16px;margin:0 0 28px;padding:0 0 20px;border-bottom:1px solid var(--line)}
dt{color:var(--mut);font-size:13px}dd{margin:0;overflow-wrap:anywhere}
.prose{font-size:16px;line-height:1.75;color:#2a231c}
.prose h1,.prose h2,.prose h3{font-family:var(--display);color:var(--ink);letter-spacing:-.02em;line-height:1.3;margin:1.5em 0 .45em}
.prose h1{font-size:1.4em}.prose h2{font-size:1.2em}.prose h3{font-size:1.05em}
.prose p{margin:.7em 0}
.prose ul,.prose ol{margin:.5em 0 .9em;padding-left:1.25em}
.prose li{margin:.28em 0}
.prose code{font-family:var(--mono);font-size:.86em;background:#efe8da;border-radius:2px;padding:.05em .35em}
.prose pre{font-family:var(--mono);font-size:13px;line-height:1.55;background:#efe8da;border:1px solid var(--line);padding:14px 16px;overflow-x:auto;white-space:pre;border-radius:var(--radius)}
.prose pre code{background:none;padding:0}
.path{margin-top:28px;color:var(--faint);font-size:12.5px}
.path code{font-family:var(--mono);overflow-wrap:anywhere}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);color:var(--mut);font-size:13px}
@media(max-width:600px){
  .frame{padding:20px 16px 56px}
  .manuscript{padding:20px 16px 28px}
  dl{grid-template-columns:1fr;gap:4px}
  dd{margin-bottom:10px}
}
`;

function inlineMarkdown(src) {
  let out = escape(src);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return out;
}

function renderMarkdown(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  let para = [];
  const flush = () => {
    if (!para.length) return;
    out.push(`<p>${inlineMarkdown(para.join('\n'))}</p>`);
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      flush();
      i += 1;
      const code = [];
      while (i < lines.length && !(lines[i] ?? '').startsWith('```')) {
        code.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) i += 1;
      out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (/^\s*[-*]\s+\S/.test(line)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+\S/.test(lines[i] ?? '')) {
        items.push(`<li>${inlineMarkdown((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''))}</li>`);
        i += 1;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (!line.trim()) {
      flush();
      i += 1;
      continue;
    }
    para.push(line);
    i += 1;
  }
  flush();
  return out.join('\n');
}

function bodyMarkdown(content) {
  const stripped = String(content).replace(/^---\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '');
  return renderMarkdown(stripped.trim() ? stripped : content);
}

function page(title, body) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · AssetCollector</title><style>${css}</style></head><body>
<!-- THESIS: procedures are manuscripts you read, not a file browser. OWN-WORLD: warm paper, cinnabar stack mark, Iowan/Songti titles. STORY: find a skill, read the steps. FIRST VIEWPORT: library heading, search, manuscript cards. FORM: bound notebook. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->
<div class="frame"><header class="bar"><a class="brand" href="/">${MARK}AssetCollector <small>只读浏览</small></a></header>${body}<footer>内容来自本地流程目录。修改文件后刷新页面即可查看更新。</footer></div></body></html>`;
}

function warnings(findings) {
  return findings.length ? `<aside class="warning" aria-label="文档检查提示"><strong>文档检查提示 · ${findings.length} 项</strong><ul>${findings.map(f => `<li>${f.name ? `${escape(f.name)}：` : ''}${escape(f.message)}</li>`).join('')}</ul></aside>` : '';
}

function hrefFor(skill) {
  return `/n/${encodeURIComponent(skill.namespace)}/${encodeURIComponent(skill.name)}`;
}

function index(root, query) {
  const catalog = list(root, query);
  return page('流程库', `<h1>流程库</h1><p class="lede">查看已登记流程的说明、原文和文档检查提示。</p><form action="/" method="get" role="search"><label for="q">搜索流程</label><div class="search"><input id="q" name="q" type="search" placeholder="名称、说明或正文" value="${escape(query)}"><button type="submit">搜索</button></div></form><p class="count">${query ? '匹配' : '已登记'} ${catalog.skills.length} 个流程${query ? ' · <a href="/">查看全部</a>' : ''}</p>${warnings(catalog.findings)}${catalog.skills.length ? `<ul class="rows">${catalog.skills.map(s => `<li><a href="${hrefFor(s)}">${escape(s.id)}</a><p>${escape(s.description)}</p><small class="muted">${s.findings.length ? `${s.findings.length} 项文档提示` : '文档检查：未发现问题'}</small></li>`).join('')}</ul>` : `<div class="empty"><h2>${query ? '没有匹配的流程' : '还没有登记流程'}</h2><p>${query ? '尝试其他关键词，或查看全部流程。' : '通过 CLI 登记已有流程后，这里就会显示。'}</p>${query ? '' : '<code>assetcollector add &lt;流程目录&gt; --namespace &lt;id&gt;</code>'}</div>`}<p class="path">目录：<code>${escape(root)}</code></p>`);
}

function detail(root, qualified) {
  const skill = show(root, qualified);
  return page(skill.id, `<a class="back" href="/">← 返回流程库</a><h1>${escape(skill.id)}</h1><p class="lede">${escape(skill.description)}</p><dl><dt>命名空间</dt><dd><code>${escape(skill.namespace)}</code></dd><dt>文件位置</dt><dd><code>${escape(skill.file)}</code></dd><dt>文档检查</dt><dd>${skill.findings.length ? `${skill.findings.length} 项提示` : '未发现问题'}（仅检查文档格式）</dd></dl>${warnings(skill.findings)}<div class="manuscript"><div class="prose">${bodyMarkdown(skill.content)}</div></div>`);
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
