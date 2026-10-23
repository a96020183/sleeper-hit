// Sealed forecast. Three files are written privately and only their SHA-256 hashes are published:
//   pool.json      the artist pool (names + Qloo ids) -> counts as Qloo response data, so private
//   ranks.json     every title's full ranking of the pool (affinity + popularity rank blend since
//                  2026-10-23; the original excess-affinity ranking is kept in the same file)
//   baselines.json the comparison predictions (popularity, an LLM, what similar titles used)
// With SEAL_PASSWORD set, files are stored encrypted (scrypt + AES-256-GCM). After winners are
// announced, ranks are unsealed with names, ranks and band percentiles only; raw affinity,
// popularity values and entity ids are never published.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function canonicalJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

export function encrypt(buf, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(buf), c.final()]);
  return JSON.stringify({ v: 1, alg: 'scrypt+aes-256-gcm', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}

export function decrypt(text, password) {
  const o = JSON.parse(text);
  const key = crypto.scryptSync(password, Buffer.from(o.salt, 'base64'), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(o.iv, 'base64'));
  d.setAuthTag(Buffer.from(o.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(o.data, 'base64')), d.final()]);
}

// files: { 'pool.json': obj, 'ranks.json': obj, 'baselines.json': obj }
export function writeSeal(dir, files, { password } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const hashes = [];
  for (const [name, obj] of Object.entries(files)) {
    const bytes = Buffer.from(canonicalJSON(obj), 'utf8');
    hashes.push({ file: name, sha256: sha256(bytes), bytes: bytes.length });
    if (password) fs.writeFileSync(path.join(dir, name + '.enc'), encrypt(bytes, password));
    else fs.writeFileSync(path.join(dir, name), bytes);
  }
  return hashes;
}

export function verifySealFile(dir, name, expectedHash, { password } = {}) {
  const enc = path.join(dir, name + '.enc');
  const bytes = fs.existsSync(enc) ? decrypt(fs.readFileSync(enc, 'utf8'), password) : fs.readFileSync(path.join(dir, name));
  return { ok: sha256(bytes) === expectedHash, bytes };
}

// What may be published after winners are announced: names, ranks, band percentiles.
// Seals written before 2026-10-23 have no blend fields; those come out as null.
export function unsealView(ranks) {
  const out = {};
  for (const [title, rows] of Object.entries(ranks.titles || {})) {
    out[title] = rows.map((r) => ({
      artist: r.name, rank: r.rank, affinityRank: r.affinityRank ?? null, popularityRank: r.popularityRank ?? null,
      bandPercentile: r.bandPct, excessRank: r.excessRank ?? null,
    }));
  }
  return { sealedAt: ranks.sealedAt, score: ranks.score || null, titles: out };
}
