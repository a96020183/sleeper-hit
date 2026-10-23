// Score the sealed forecast against the songs released titles actually used.
//   SEAL_PASSWORD=… npm run settle              check hashes, score, write seal/results.json
//   SEAL_PASSWORD=… npm run settle -- --unseal  also publish names, ranks and band percentiles
//                                               (seal/unsealed.json); never raw Qloo values or ids
// Lists come from src/data/new_soundtracks.js, added by a person from public listings after release.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../src/config.js';
import { verifySealFile, unsealView } from '../src/seal.js';
import { settle } from '../src/settle.js';
import { NEW_SOUNDTRACKS, KNOWN_BEFORE_SEAL } from '../src/data/new_soundtracks.js';
import { PRIOR_SOUNDTRACKS } from '../src/data/prior_soundtracks.js';

const pubFile = path.join(ROOT, 'seal', 'hashes.json');
if (!fs.existsSync(pubFile)) { console.log('Not sealed yet: seal/hashes.json is missing. Run the final seal first.'); process.exit(1); }
const pub = JSON.parse(fs.readFileSync(pubFile, 'utf8'));
const dir = path.join(config.privateDir, 'sealed', `final-${pub.sealedAt.replace(/[:.]/g, '-')}`);
if (!fs.existsSync(dir)) { console.log(`Private seal files not found in ${path.relative(ROOT, dir)}.`); process.exit(1); }
const password = process.env.SEAL_PASSWORD || '';

const files = {};
for (const f of pub.files) {
  const { ok, bytes } = verifySealFile(dir, f.file, f.sha256, { password });
  if (!ok) { console.log(`${f.file}: hash does NOT match the published one. Stopping.`); process.exit(1); }
  files[f.file] = JSON.parse(bytes.toString('utf8'));
  console.log(`${f.file}: hash matches ${f.sha256.slice(0, 12)}…`);
}

const result = settle({
  pool: files['pool.json'].artists,
  ranks: files['ranks.json'],
  baselines: files['baselines.json'],
  lists: NEW_SOUNDTRACKS,
  priorLists: PRIOR_SOUNDTRACKS,
  knownBeforeSeal: KNOWN_BEFORE_SEAL,
});
const out = { settledAt: new Date().toISOString(), sealedAt: pub.sealedAt, titlesWithLists: result.perTitle.length, ...result };
fs.writeFileSync(path.join(ROOT, 'seal', 'results.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`Titles with lists: ${result.perTitle.length}. Positives: ${result.positives}. Pooled AUC: ${Object.entries(result.pooledAuc).map(([k, v]) => `${k} ${v ?? '-'}`).join(', ')}`);
console.log(`Verdict: ${result.verdict} (${result.why}). Written to seal/results.json`);
if (process.argv.includes('--unseal')) {
  fs.writeFileSync(path.join(ROOT, 'seal', 'unsealed.json'), JSON.stringify(unsealView(files['ranks.json']), null, 1) + '\n');
  console.log('Unsealed names, ranks and band percentiles: seal/unsealed.json');
}
