// ─── Temporary file store for generated PDFs ─────────────────────
// In-memory, per process: links only work on the instance that made them.
import crypto from 'crypto';

const TTL_MS = Math.max(60_000, Number(process.env.MCP_FILE_TTL_MS) || 30 * 60 * 1000);
const MAX_FILES = Math.max(1, Number(process.env.MCP_MAX_FILES) || 50);
const MAX_BYTES = Math.max(1, Number(process.env.MCP_FILE_STORE_MB) || 200) * 1024 * 1024;
const ID_RE = /^[0-9a-f]{48}$/;
const store = new Map(); // insertion order = age order
let totalBytes = 0;

function drop(id) {
  const f = store.get(id);
  if (f) { totalBytes -= f.buffer.length; store.delete(id); }
}

function sweep() {
  const now = Date.now();
  for (const [k, f] of store) if (f.expires <= now) drop(k);
}

/** Store a buffer; evicts expired, then oldest entries to stay within MAX_FILES / MAX_BYTES. */
export function saveFile(buffer, filename, mime = 'application/pdf') {
  if (buffer.length > MAX_BYTES) throw new Error('Generated file is too large to store.');
  sweep();
  while (store.size >= MAX_FILES || (store.size && totalBytes + buffer.length > MAX_BYTES)) {
    drop(store.keys().next().value);
  }
  const id = crypto.randomBytes(24).toString('hex');
  const expires = Date.now() + TTL_MS;
  const safeName = String(filename).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 150) || 'pressroom-article.pdf';
  store.set(id, { buffer, filename: safeName, mime, expires });
  totalBytes += buffer.length;
  return { id, filename: safeName, expiresAt: new Date(expires).toISOString() };
}

export function getFile(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) return null;
  const f = store.get(id);
  if (!f) return null;
  if (f.expires <= Date.now()) { drop(id); return null; }
  return f;
}

export function storeStats() {
  return { files: store.size, bytes: totalBytes, maxFiles: MAX_FILES, maxBytes: MAX_BYTES };
}

setInterval(sweep, 60_000).unref();
