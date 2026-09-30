/** Ad-free edition: retain the admin API shape without any advertising requests. */
import rateLimit from 'express-rate-limit';
import db from '../db.js';
import { isOwnerEmail } from '../utils/auth-roles.js';
import { toIPv4 } from '../middleware/security.js';

export const adReportsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  keyGenerator: (req) => req.session?.user?.id || toIPv4(null, req),
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'rate_limit' }),
});

function emptyTotals() {
  return { earnings: 0, clicks: 0, uniqueUsers: 0, uniqueVisitors: 0, impressions: 0,
    views: 0, videoViews: 0, ecpm: 0, vtr: 0 };
}

export async function getAdminAdReportsHandler(req, res) {
  if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
  const user = db.prepare('SELECT is_admin, email, email_verified, banned FROM users WHERE id = ?').get(req.session.user.id);
  if (!user || user.banned) return res.status(401).json({ error: 'Unauthorized' });
  if (Number(user.is_admin || 0) < 1 && !isOwnerEmail(user.email, user.email_verified)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.json({
    disabled: true,
    reason: 'ad-free',
    configured: false,
    proxy: false,
    generatedAt: Date.now(),
    day: new Date().toISOString().slice(0, 10),
    ours: { today: emptyTotals(), yesterday: emptyTotals(), d7: emptyTotals(),
      d30: emptyTotals(), hours: [], daily: [] },
    exoclick: { ok: false, error: 'disabled', currency: 'USD', timezone: 'UTC',
      today: emptyTotals(), yesterday: emptyTotals(), d7: emptyTotals(),
      d30: emptyTotals(), byZone: [], byCountry: [], byDevice: [], byDate: [], bySite: [] },
    compare: { todayOurs: 0, todayExoclick: 0, delta: 0, ratio: null,
      uniqueOurs: 0, uniqueExoclick: 0 },
    balance: null,
    insights: [{ tone: 'info', title: 'Advertising disabled',
      body: 'This edition does not serve advertisements or contact advertising analytics providers.' }],
  });
}
