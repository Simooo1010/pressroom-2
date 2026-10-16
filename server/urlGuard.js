// ─── URL Guard ────────────────────────────────────────────────────
// Anti-SSRF helpers: block private/loopback targets (including after
// redirects) and optionally restrict to an allowlist of hosts.
// ──────────────────────────────────────────────────────────────────

import dns from 'dns/promises';
import net from 'net';

const ALLOW_PRIVATE = process.env.PRESSROOM_ALLOW_PRIVATE === '1'; // tests only

/** True if the IP literal is loopback, private, link-local or otherwise non-public. */
export function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateIp(mapped[1]) : false;
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

/** Throws unless the URL is http(s) and every resolved address is public. */
export async function assertPublicUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('Invalid URL.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) URLs are allowed.');
  if (ALLOW_PRIVATE) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new Error('This host is not allowed.');
  }
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (addrs.some((a) => isPrivateIp(a.address))) throw new Error('This host is not allowed.');
  return u;
}

/** Allowlist: substack.com + subdomains + MCP_EXTRA_HOSTS (comma-separated). */
export function assertAllowedHost(rawUrl) {
  const u = new URL(rawUrl);
  const extra = (process.env.MCP_EXTRA_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const allowed = ['substack.com', ...extra];
  const h = u.hostname.toLowerCase();
  if (!allowed.some((d) => h === d || h.endsWith('.' + d))) {
    throw new Error(
      `Host "${h}" is not allowed. Allowed: substack.com and its subdomains` +
      (extra.length ? `, ${extra.join(', ')}` : '') + '. Custom domains must be added to MCP_EXTRA_HOSTS.'
    );
  }
  return u;
}

/** fetch() that re-validates every redirect hop against assertPublicUrl. */
export async function safeFetch(url, init = {}, maxRedirects = 5) {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects.');
}
