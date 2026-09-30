import { isIP } from 'node:net';

const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Honor forwarding headers from the local proxy, or Render's managed proxy
// when deployed there. Direct clients outside Render cannot choose their IP.
export function peerIsTrusted(req) {
  const peer = req?.socket?.remoteAddress || req?.connection?.remoteAddress || '';
  // Render exposes this process through its managed reverse proxy only.
  return LOOPBACK_PEERS.has(peer) || process.env.RENDER === 'true';
}

export function toIPv4(ip, req = null) {
  if (req) {
    const peer = req.socket?.remoteAddress || req.connection?.remoteAddress;
    if (peerIsTrusted(req)) {
      const xff = req.headers['x-forwarded-for'];
      const cf = req.headers['cf-connecting-ip'];
      const real = req.headers['x-real-ip'];
      if (typeof xff === 'string' && xff) {
        const hops = xff.split(',');
        ip = hops[process.env.RENDER === 'true' ? hops.length - 1 : 0].trim();
      }
      else if (cf) ip = cf;
      else if (real) ip = real;
      else ip = peer;
    } else {
      ip = peer;
    }
  }
  if (!ip) return '127.0.0.1';
  if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
  if (typeof ip === 'string' && ip.startsWith('::ffff:')) ip = ip.replace('::ffff:', '');
  // The historical name is retained for callers, but IPv6 visitors must keep
  // distinct identities for rate limits, challenge state, and fingerprints.
  return typeof ip === 'string' && isIP(ip) ? ip : '127.0.0.1';
}
