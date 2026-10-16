// ─── URL Guard ────────────────────────────────────────────────────
// Anti-SSRF helpers: block private/loopback/link-local/reserved targets
// (including IPv4-mapped / NAT64 / 6to4 IPv6 forms and after redirects),
// pin the validated IP at connect time (no DNS-rebinding window) and
// optionally restrict to an allowlist of hosts.
// ──────────────────────────────────────────────────────────────────

import dns from 'dns';
import net from 'net';
import http from 'http';
import https from 'https';
import zlib from 'zlib';

const ALLOW_PRIVATE = process.env.PRESSROOM_ALLOW_PRIVATE === '1'; // tests only

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 20 * 1024 * 1024;

// IPv4 ranges that are not publicly routable (RFC 6890 & friends).
const V4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([a, bits]) => [v4ToInt(a), bits]);

function v4ToInt(ip) {
  return ip.split('.').reduce((n, o) => ((n << 8) | Number(o)) >>> 0, 0);
}

function isPrivateV4(ip) {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => ((n ^ base) >>> (32 - bits)) === 0);
}

/** Expand an IPv6 literal (any notation, incl. trailing dotted IPv4) to 8 hextets. */
function v6Hextets(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, ''); // drop zone id
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const n = v4ToInt(dotted[1]);
    s = s.slice(0, -dotted[1].length) + ((n >>> 16).toString(16)) + ':' + ((n & 0xffff).toString(16));
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined ? (tail ? tail.split(':') : []) : null;
  const parts = t ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  return parts.map((p) => parseInt(p, 16));
}

const v4FromHextets = (a, b) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;

function isPrivateV6(ip) {
  const x = v6Hextets(ip);
  if (x.length !== 8 || x.some((n) => Number.isNaN(n))) return true;
  const zero = (from, to) => x.slice(from, to).every((n) => n === 0);
  // ::/128 unspecified, ::1 loopback, ::/96 IPv4-compatible (deprecated) → never public
  if (zero(0, 6)) return true;
  // ::ffff:0:0/96 IPv4-mapped  → judge the embedded IPv4
  if (zero(0, 5) && x[5] === 0xffff) return isPrivateV4(v4FromHextets(x[6], x[7]));
  // ::ffff:0:0:0/96 IPv4-translated (SIIT)
  if (zero(0, 4) && x[4] === 0xffff && x[5] === 0) return true;
  // 64:ff9b::/96 NAT64 well-known prefix → embedded IPv4; 64:ff9b:1::/48 local-use NAT64
  if (x[0] === 0x64 && x[1] === 0xff9b) return x[2] === 1 || !zero(2, 6) || isPrivateV4(v4FromHextets(x[6], x[7]));
  // 2002::/16 6to4 → embedded IPv4 in hextets 1-2
  if (x[0] === 0x2002) return isPrivateV4(v4FromHextets(x[1], x[2]));
  // 2001::/32 Teredo, 2001:db8::/32 documentation, 2001:10::/28 ORCHID, 2001:20::/28 ORCHIDv2
  if (x[0] === 0x2001 && (x[1] === 0 || x[1] === 0xdb8 || (x[1] & 0xffe0) === 0x0010 || (x[1] & 0xfff0) === 0x0020)) return true;
  // Only 2000::/3 global unicast is public; this excludes fc00::/7 ULA, fe80::/10 link-local,
  // fec0::/10 site-local, ff00::/8 multicast, 100::/64 discard, etc.
  return (x[0] & 0xe000) !== 0x2000;
}

/** True if the IP literal is loopback, private, link-local or otherwise non-public. Non-IPs → true. */
export function isPrivateIp(ip) {
  const s = String(ip).replace(/^\[|\]$/g, '');
  if (net.isIPv4(s)) return isPrivateV4(s);
  if (net.isIPv6(s.replace(/%.*$/, ''))) return isPrivateV6(s);
  return true;
}

function normHost(u) {
  return u.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
}

function blockedName(host) {
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') ||
    host.endsWith('.local') || host.endsWith('.home.arpa') || !host.includes('.') && !net.isIP(host);
}

const notAllowed = () => Object.assign(new Error('This host is not allowed.'), { code: 'EHOSTBLOCKED' });

/** Throws unless the URL is http(s) and every resolved address is public. */
export async function assertPublicUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('Invalid URL.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) URLs are allowed.');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed.');
  if (ALLOW_PRIVATE) return u;
  const host = normHost(u);
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw notAllowed();
    return u;
  }
  if (blockedName(host)) throw notAllowed();
  let addrs;
  try { addrs = await dns.promises.lookup(host, { all: true, verbatim: true }); } catch (e) {
    throw Object.assign(new Error(`Could not resolve host "${host}".`), { code: e.code });
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw notAllowed();
  return u;
}

/** Allowlist: substack.com + subdomains + MCP_EXTRA_HOSTS (comma-separated). */
export function assertAllowedHost(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('Invalid URL.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http(s) URLs are allowed.');
  if (u.username || u.password) throw new Error('URLs with credentials are not allowed.');
  const extra = (process.env.MCP_EXTRA_HOSTS || '').split(',').map((s) => s.trim().toLowerCase().replace(/\.+$/, '')).filter(Boolean);
  const allowed = ['substack.com', ...extra];
  const h = normHost(u);
  // Subdomain matching only for DNS names: "x.127.0.0.1" is never a thing.
  if (!allowed.some((d) => h === d || (!net.isIP(d) && h.endsWith('.' + d)))) {
    throw new Error(
      `Host "${h}" is not allowed. Allowed: substack.com and its subdomains` +
      (extra.length ? `, ${extra.join(', ')}` : '') + '. Custom domains must be added to MCP_EXTRA_HOSTS.'
    );
  }
  return u;
}

/**
 * dns.lookup replacement used at socket-connect time: rejects private
 * addresses, so the IP that was validated is the IP that is connected to.
 */
function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  if (typeof options === 'number') options = { family: options };
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!ALLOW_PRIVATE && (!addrs.length || addrs.some((a) => isPrivateIp(a.address)))) return cb(notAllowed());
    if (options.all) return cb(null, addrs);
    return cb(null, addrs[0].address, addrs[0].family);
  });
}

function headersToObject(init = {}) {
  const out = {};
  new Headers(init.headers || {}).forEach((v, k) => { out[k] = v; });
  return out;
}

function decoderFor(encoding) {
  switch ((encoding || '').trim().toLowerCase()) {
    case 'gzip': case 'x-gzip': return zlib.createGunzip();
    case 'deflate': return zlib.createInflate();
    case 'br': return zlib.createBrotliDecompress();
    default: return null;
  }
}

/** One HTTP hop with the guarded lookup, timeout and body cap. Resolves to a WHATWG Response. */
function requestOnce(url, init) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const headers = { 'accept-encoding': 'gzip, deflate, br', ...headersToObject(init) };
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const req = mod.request(url, { method: init.method || 'GET', headers, lookup: guardedLookup, agent: false }, (res) => {
      const status = res.statusCode;
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers)) {
        for (const item of [].concat(v)) resHeaders.append(k, item);
      }
      if ((status >= 300 && status < 400) || status === 204 || status === 304 || (init.method || 'GET') === 'HEAD') {
        res.resume();
        return done(resolve, new Response(null, { status: status < 200 || status > 599 ? 502 : status, statusText: res.statusMessage || '', headers: resHeaders }));
      }
      const dec = decoderFor(res.headers['content-encoding']);
      const body = dec ? res.pipe(dec) : res;
      const chunks = [];
      let size = 0;
      body.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) { req.destroy(); done(reject, new Error('Response too large.')); return; }
        chunks.push(c);
      });
      body.on('end', () => {
        resHeaders.delete('content-encoding');
        resHeaders.delete('content-length');
        done(resolve, new Response(Buffer.concat(chunks), {
          status: status < 200 || status > 599 ? 502 : status,
          statusText: res.statusMessage || '',
          headers: resHeaders,
        }));
      });
      body.on('error', (e) => done(reject, e));
      res.on('error', (e) => done(reject, e));
    });
    const timer = setTimeout(() => { req.destroy(); done(reject, new Error('Upstream request timed out.')); }, FETCH_TIMEOUT_MS);
    req.on('error', (e) => done(reject, e));
    req.end();
  });
}

/**
 * fetch()-like helper: validates every redirect hop against assertPublicUrl
 * and pins the validated IP at connect time. Returns a WHATWG Response.
 */
export async function safeFetch(url, init = {}, maxRedirects = 5) {
  let current = String(url);
  for (let i = 0; i <= maxRedirects; i++) {
    const u = await assertPublicUrl(current);
    const res = await requestOnce(u, init);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects.');
}
