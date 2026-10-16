// ─── Temporary file store for generated PDFs ─────────────────────
import crypto from 'crypto';

const TTL_MS = Number(process.env.MCP_FILE_TTL_MS || 30 * 60 * 1000);
const MAX_FILES = 50;
const store = new Map();

export function saveFile(buffer, filename, mime = 'application/pdf') {
  const id = crypto.randomBytes(24).toString('hex');
  store.set(id, { buffer, filename, mime, expires: Date.now() + TTL_MS });
  while (store.size > MAX_FILES) store.delete(store.keys().next().value);
  return { id, expiresAt: new Date(Date.now() + TTL_MS).toISOString() };
}
export function getFile(id) {
  const f = store.get(id);
  if (!f) return null;
  if (f.expires < Date.now()) { store.delete(id); return null; }
  return f;
}
setInterval(() => { for (const [k, f] of store) if (f.expires < Date.now()) store.delete(k); }, 60_000).unref();
