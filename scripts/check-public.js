// Pre-publish check: make sure no Qloo response data or secrets sit in files that would be public.
// Scans everything except git-ignored folders. Exit code 1 on any finding.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';

const SKIP_DIRS = new Set(['.git', '.private', 'node_modules']);
const SKIP_FILES = new Set(['.env', '進度.md']);
const RULES = [
  { name: 'Qloo entity id (UUID)', re: /\b[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\b/ },
  { name: 'raw affinity value', re: /"affinity"\s*:\s*0?\.\d+/ },
  { name: 'raw popularity value', re: /"popularity"\s*:\s*0?\.\d+/ },
  { name: 'raw Qloo response', re: /"results"\s*:\s*\{\s*"entities"/ },
  { name: 'raw Qloo trending value', re: /"population_(rank|percentile)"\s*:/ },
  { name: 'API key assignment', re: /(QLOO_API_KEY|OPENAI_API_KEY)\s*=\s*[A-Za-z0-9_\-]{12,}/ },
  { name: 'OpenAI-style secret', re: /\bsk-[A-Za-z0-9_\-]{20,}/ },
];

const findings = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name)); continue; }
    if (SKIP_FILES.has(e.name) || /\.(png|jpg|ico|pdf)$/i.test(e.name)) continue;
    const file = path.join(dir, e.name);
    const text = fs.readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((line, i) => {
      for (const r of RULES) if (r.re.test(line)) findings.push(`${path.relative(ROOT, file)}:${i + 1}  ${r.name}`);
    });
  }
}
walk(ROOT);
// The real key must not appear anywhere outside .env
const key = process.env.QLOO_API_KEY;
if (key && key.length > 8) {
  (function scan(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['.git', 'node_modules'].includes(e.name)) scan(p); continue; }
      if (e.name === '.env') continue;
      if (fs.readFileSync(p).includes(key)) findings.push(`${path.relative(ROOT, p)}  contains the Qloo key`);
    }
  })(ROOT);
}
if (findings.length) {
  console.log('Found data that must not be public:\n' + findings.join('\n'));
  process.exit(1);
}
console.log('Public check passed: no Qloo response data, entity ids or keys outside git-ignored files.');
