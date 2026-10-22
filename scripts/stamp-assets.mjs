#!/usr/bin/env node
/**
 * 静态资源版本戳（cache busting）
 * ---------------------------------------------------------------------------
 * 背景：源站 nginx 对 js/css 设了 12 小时缓存，改完代码后浏览器仍用旧的，
 *       表现为"导航里少了新加的入口"这类假故障。
 *
 * 做法：把 HTML 里对本站 /assets/css/*.css 与 /assets/js/*.js 的引用
 *       改写成 `<文件>?v=<内容哈希前 8 位>`。内容变了哈希就变，URL 就变，
 *       浏览器必然重新下载；内容没变则 URL 不变，缓存照常命中。
 *
 * 幂等：已带 ?v= 且哈希一致时不动。
 *
 * 用法：
 *   node scripts/stamp-assets.mjs              # 处理 website/（含 en/）
 *   node scripts/stamp-assets.mjs <目录>        # 处理指定目录（部署暂存目录）
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const target = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'website');
const assetRoot = existsSync(join(target, 'assets')) ? target : join(ROOT, 'website');

/** 读取资源文件并取内容哈希（找不到就返回 null，保持原样） */
function hashOf(relPath) {
  const p = join(assetRoot, relPath.replace(/^\//, ''));
  if (!existsSync(p)) return null;
  const buf = readFileSync(p);
  return createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

/** 收集所有 html 文件 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '_bodies') continue;
      walk(p, out);
    } else if (extname(name).toLowerCase() === '.html') {
      out.push(p);
    }
  }
  return out;
}

const files = walk(target);
let changed = 0;
let refs = 0;

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let after = before;

  /* 同时匹配带/不带已有 ?v= 的引用 */
  after = after.replace(
    /(\/assets\/(?:css|js|img)\/[A-Za-z0-9._/-]+\.(?:css|js|png|webp|svg|jpg|ico))(\?v=[a-f0-9]{8})?/g,
    (match, pathAndFile) => {
      const hash = hashOf(pathAndFile);
      if (!hash) return match;
      refs++;
      return pathAndFile + '?v=' + hash;
    }
  );

  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    changed++;
  }
}

console.log('资源版本戳完成');
console.log('  目录：' + target.replace(ROOT, '.'));
console.log('  处理 HTML：' + files.length + ' 个，改写 ' + changed + ' 个，资源引用 ' + refs + ' 处');

/* 抽样打印，便于核对 */
const sample = files.find((f) => f.endsWith('index.html')) || files[0];
if (sample) {
  const html = readFileSync(sample, 'utf8');
  const m = html.match(/\/assets\/(?:css|js)\/[A-Za-z0-9._-]+\.(?:css|js)\?v=[a-f0-9]{8}/g) || [];
  console.log('  抽样 ' + sample.replace(target, '').replace(/^[\\/]/, '') + '：');
  m.slice(0, 6).forEach((x) => console.log('    ' + x));
}
