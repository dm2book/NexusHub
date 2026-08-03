/**
 * What we can tell about the network an order came from.
 *
 * There is no paid IP-intelligence service behind this, and the code says so
 * rather than implying more certainty than it has. What it can actually detect:
 *
 *   HOSTING / DATACENTER addresses — every cheap VPN, every scripted bot and
 *   every headless browser farm runs out of one. That is the bulk of what
 *   attacks a small shop, and it is detectable offline.
 *
 * What it CANNOT detect: a residential-proxy VPN, or a consumer VPN whose exit
 * node sits on a normal ISP address. Those look exactly like a real customer,
 * because on the network they are one. Anyone claiming otherwise without a
 * commercial feed is guessing.
 *
 * So this produces a SIGNAL with a weight, never a verdict. A datacenter IP is
 * not fraud — it is a developer on a VPS, a privacy-conscious buyer, or someone
 * on a corporate VPN. It is worth points towards a review, and nothing more.
 *
 * Two independent methods, because each fails differently:
 *
 *  1. Reverse DNS. Datacenter addresses name themselves — `ec2-…amazonaws.com`,
 *     `…hetzner.de`, `static.vps…`. Consumer ISPs also name themselves, just
 *     differently. Cheap, offline, and wrong often enough that it only ever
 *     contributes weight.
 *  2. Known hosting ranges. Only ranges whose ownership is unambiguous are
 *     listed. A wrong range here turns real customers away, so the list stays
 *     short and certain rather than long and probabilistic.
 */
import { promises as dns } from 'node:dns';

/**
 * Hosting ranges. Deliberately conservative — every entry is a block whose
 * registered holder is a hosting provider outright, not a mixed allocation.
 * Missing a VPN costs a signal; adding a consumer range costs a customer.
 */
const HOSTING_V4 = [
  ['3.0.0.0', 8],        // Amazon (the whole /8, ex-GE)
  ['13.32.0.0', 12],     // Amazon CloudFront
  ['15.177.0.0', 16],    // Amazon
  ['16.16.0.0', 12],     // Amazon
  ['35.180.0.0', 14],    // Google Cloud / Amazon eu-west-3
  ['51.15.0.0', 16],     // Scaleway
  ['51.75.0.0', 16],     // OVH
  ['51.68.0.0', 16],     // OVH
  ['51.83.0.0', 16],     // OVH
  ['51.89.0.0', 16],     // OVH
  ['51.91.0.0', 16],     // OVH
  ['54.36.0.0', 14],     // OVH
  ['64.225.0.0', 16],    // DigitalOcean
  ['68.183.0.0', 16],    // DigitalOcean
  ['104.131.0.0', 16],   // DigitalOcean
  ['134.209.0.0', 16],   // DigitalOcean
  ['138.68.0.0', 16],    // DigitalOcean
  ['142.93.0.0', 16],    // DigitalOcean
  ['143.110.0.0', 16],   // DigitalOcean
  ['146.190.0.0', 16],   // DigitalOcean
  ['157.230.0.0', 16],   // DigitalOcean
  ['159.65.0.0', 16],    // DigitalOcean
  ['159.89.0.0', 16],    // DigitalOcean
  ['161.35.0.0', 16],    // DigitalOcean
  ['164.90.0.0', 16],    // DigitalOcean
  ['165.22.0.0', 16],    // DigitalOcean
  ['167.71.0.0', 16],    // DigitalOcean
  ['167.99.0.0', 16],    // DigitalOcean
  ['174.138.0.0', 16],   // DigitalOcean
  ['178.62.0.0', 16],    // DigitalOcean
  ['188.166.0.0', 16],   // DigitalOcean
  ['206.189.0.0', 16],   // DigitalOcean
  ['209.97.0.0', 16],    // DigitalOcean
  ['5.9.0.0', 16],       // Hetzner
  ['78.46.0.0', 15],     // Hetzner
  ['88.99.0.0', 16],     // Hetzner
  ['94.130.0.0', 16],    // Hetzner
  ['116.202.0.0', 16],   // Hetzner
  ['116.203.0.0', 16],   // Hetzner
  ['135.181.0.0', 16],   // Hetzner
  ['138.201.0.0', 16],   // Hetzner
  ['144.76.0.0', 16],    // Hetzner
  ['148.251.0.0', 16],   // Hetzner
  ['159.69.0.0', 16],    // Hetzner
  ['162.55.0.0', 16],    // Hetzner
  ['167.235.0.0', 16],   // Hetzner
  ['168.119.0.0', 16],   // Hetzner
  ['176.9.0.0', 16],     // Hetzner
  ['178.63.0.0', 16],    // Hetzner
  ['195.201.0.0', 16],   // Hetzner
  ['213.239.192.0', 18], // Hetzner
  ['45.32.0.0', 16],     // Vultr
  ['45.63.0.0', 16],     // Vultr
  ['45.76.0.0', 16],     // Vultr
  ['66.42.0.0', 16],     // Vultr
  ['95.179.0.0', 16],    // Vultr
  ['104.238.0.0', 16],   // Vultr
  ['108.61.0.0', 16],    // Vultr
  ['149.28.0.0', 16],    // Vultr
  ['155.138.0.0', 16],   // Vultr
  ['185.92.220.0', 22],  // Linode/Akamai
  ['139.162.0.0', 16],   // Linode
  ['172.104.0.0', 15],   // Linode
  ['176.58.96.0', 19],   // Linode
  ['178.79.128.0', 17],  // Linode
];

/** Reverse-DNS fragments that mean "this is a machine, not a living room". */
const HOSTING_HOSTNAME = /(^|[.-])(ec2|compute|amazonaws|googleusercontent|cloudapp|azure|linode(users)?|digitalocean|vultr|hetzner|contabo|ovh|scaleway|hostwinds|leaseweb|choopa|colocrossing|dedicated|datacenter|servers?|vps|vserver|cloud|hosting|proxy|vpn|tor-exit|relay)([.-]|$)/i;

/** …and fragments that mean the opposite: a consumer line. Checked first. */
const RESIDENTIAL_HOSTNAME = /(^|[.-])(dsl|adsl|vdsl|cable|kabel|fiber|glasvezel|dyn|dynamic|pool|client|customer|broadband|home|res|mobile|gprs|lte|kpn|ziggo|xs4all|telfort|t-mobile|vodafone|proximus|telenet|orange|bbox|comcast|verizon|virginmedia|bt|sky)([.-]|$)/i;

const ipToLong = (ip) => {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n;
};

/** Loopback, RFC1918 and link-local. Local development, not a customer. */
export function isPrivateIp(ip) {
  if (!ip) return true;
  const clean = String(ip).replace(/^::ffff:/i, '');
  if (clean === '::1' || clean === '127.0.0.1' || clean.startsWith('fe80:') || clean.startsWith('fc') || clean.startsWith('fd')) return true;
  const n = ipToLong(clean);
  if (n === null) return false;
  return (n >>> 24) === 10
    || (n >>> 20) === 0xac1                      // 172.16.0.0/12
    || (n >>> 16) === 0xc0a8                     // 192.168.0.0/16
    || (n >>> 24) === 127
    || (n >>> 16) === 0xa9fe;                    // 169.254.0.0/16
}

/** Is this address inside a range we know belongs to a hosting provider? */
export function isHostingRange(ip) {
  const n = ipToLong(String(ip || '').replace(/^::ffff:/i, ''));
  if (n === null) return false;
  for (const [base, bits] of HOSTING_V4) {
    const b = ipToLong(base);
    if (b === null) continue;
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    if ((n & mask) >>> 0 === (b & mask) >>> 0) return true;
  }
  return false;
}

// A DNS round trip per order is fine; a DNS round trip per order per RETRY is
// not. Cached by address, and bounded so a scripted flood cannot grow it.
const rdnsCache = new Map();
const RDNS_MAX = 5000;

/**
 * Reverse-DNS lookup with a hard timeout.
 *
 * Never allowed to slow down checkout: an unanswered lookup resolves to null
 * and the signal is simply absent. A shop that cannot take orders because a
 * nameserver is sulking is a worse outcome than a fraud signal it missed.
 */
async function reverseDns(ip, timeoutMs = 1200) {
  if (rdnsCache.has(ip)) return rdnsCache.get(ip);
  let names = null;
  try {
    names = await Promise.race([
      dns.reverse(ip),
      new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch { names = []; }        // NXDOMAIN — no PTR at all, which is itself a hint
  const host = Array.isArray(names) && names.length ? String(names[0]).toLowerCase() : null;
  if (rdnsCache.size >= RDNS_MAX) rdnsCache.clear();
  rdnsCache.set(ip, host);
  return host;
}

/**
 * Assess the network an order arrived from.
 *
 * Returns `{ hosting, confidence, hostname, reason }`. `hosting` true means the
 * address looks like a machine in a datacenter — which is what a VPN, a proxy
 * and a bot all look like, and what a customer on their sofa does not.
 *
 * `confidence` is 'high' when a known range matched (that is ownership, not
 * inference) and 'medium' when only the hostname suggested it.
 */
export async function assessIp(ip) {
  const clean = String(ip || '').replace(/^::ffff:/i, '').trim();
  if (!clean || isPrivateIp(clean)) {
    return { hosting: false, confidence: 'none', hostname: null, reason: 'local or unknown address' };
  }

  if (isHostingRange(clean)) {
    return { hosting: true, confidence: 'high', hostname: null, reason: 'address belongs to a hosting provider' };
  }

  const hostname = await reverseDns(clean);
  // A consumer ISP naming its own line. Believed over the hosting pattern
  // below, because "cable" and "dynamic" are never what a datacenter calls a
  // machine, while "server" turns up in plenty of ISP naming schemes.
  if (hostname && RESIDENTIAL_HOSTNAME.test(hostname)) {
    return { hosting: false, confidence: 'medium', hostname, reason: 'consumer ISP address' };
  }
  if (hostname && HOSTING_HOSTNAME.test(hostname)) {
    return { hosting: true, confidence: 'medium', hostname, reason: `hostname looks like hosting (${hostname})` };
  }
  // No PTR at all. Weak on its own — plenty of legitimate networks skip it — so
  // it is reported but not called hosting.
  return {
    hosting: false,
    confidence: hostname === null ? 'low' : 'none',
    hostname,
    reason: hostname === null ? 'no reverse DNS' : 'no hosting indicators',
  };
}

/**
 * The country a request came from, when the platform tells us for free.
 *
 * Vercel sets this header on every request; there is no lookup and no service.
 * Absent everywhere else, and absent is not "unknown country" — it is no signal
 * at all, which is why the caller has to handle null rather than get a guess.
 */
export function countryOf(req) {
  const c = req?.headers?.['x-vercel-ip-country'] || req?.headers?.['cf-ipcountry'] || '';
  const code = String(c).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== 'XX' ? code : null;
}

/** Only used by tests, to keep one case from leaking into the next. */
export const _clearRdnsCache = () => rdnsCache.clear();
