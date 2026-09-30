/** Ad-free fork, modified 2026-09-30. Never request ad creatives or record impressions. */
export const adsGateLimiter = (_req, _res, next) => next();
export const adsVastLimiter = (_req, _res, next) => next();
export async function adsGateHandler(_req, res) { return res.json({ show: false, reason: 'ad-free' }); }
export async function adsShownHandler(_req, res) { return res.json({ ok: true, disabled: true }); }
export async function adsVastHandler(_req, res) { return res.json({ tagUrl: '', mediaUrl: '', clickThrough: '' }); }
export async function adsVastXmlHandler(_req, res) { return res.status(204).end(); }
