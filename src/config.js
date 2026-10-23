// Runtime configuration. Secrets are read from the environment (or a local .env file)
// and are never logged, cached, or sent to the browser.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const env = process.env;
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

export const config = {
  port: num(env.PORT, 3000),
  // Qloo: live when a key is present, unless QLOO_MODE=mock forces the offline fallback.
  qlooKey: env.QLOO_API_KEY || '',
  qlooBase: (env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/+$/, ''),
  qlooMode: (env.QLOO_MODE || (env.QLOO_API_KEY ? 'live' : 'mock')).toLowerCase(),
  qlooReqPerSec: num(env.QLOO_REQ_PER_SEC, 4), // documented limit is 10/s; stay well under it
  qlooMonthlyFloor: num(env.QLOO_MONTHLY_FLOOR, 500), // stop live calls when the monthly quota left drops below this
  qlooChunk: num(env.QLOO_CHUNK, 50), // ids per filter.results.entities request (take max is 50)
  // OpenAI (letters + LLM baseline). Without a key the app uses a plain template and says so.
  openaiKey: env.OPENAI_API_KEY || '',
  openaiModel: env.OPENAI_MODEL || 'gpt-4.1-mini',
  // Pool definition (public): the first N artists Qloo returns for popularity >= 0.9, most popular
  // first. Qloo paging skips some very popular artists, so it is not the complete top N.
  // Pool members themselves are never published, only hashed.
  poolN: num(env.POOL_N, 3000),
  poolBands: 10,
  peerBandSize: num(env.PEER_BAND_SIZE, 100),
  // "Today" can be pinned for demos and tests (YYYY-MM-DD).
  today: env.SLEEPERHIT_TODAY || '',
  privateDir: path.join(ROOT, '.private'),
};

export function todayISO() {
  if (config.today) return config.today;
  const d = new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
