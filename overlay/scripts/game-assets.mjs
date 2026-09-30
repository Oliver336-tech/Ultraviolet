/**
 * Serve the game libraries that upstream excludes from its git checkout.
 * All origins and versions are fixed here; this is not a general-purpose proxy.
 * Original copyright/license notices remain in the game files.
 */
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const GAME_ASSET_SOURCES = Object.freeze({
  petezah: {
    repository: 'https://github.com/PeteZah-Games/Games-lib',
    revision: '1534c55d4771fa93742120c8c0ef29d2ee48f089',
    origins: [
      'https://cdn.jsdelivr.net/gh/PeteZah-Games/Games-lib@1534c55d4771fa93742120c8c0ef29d2ee48f089/',
      'https://raw.githubusercontent.com/PeteZah-Games/Games-lib/1534c55d4771fa93742120c8c0ef29d2ee48f089/',
    ],
    attribution: 'PeteZah Games and the individual game authors; per-game notices are preserved.',
  },
  echo: {
    repository: 'https://gitlab.com/3kh0/3kh0-assets',
    revision: 'ff73bc4b150bcc3d18fe719bdb50e4338742e4f9',
    origins: ['https://gitlab.com/3kh0/3kh0-assets/-/raw/ff73bc4b150bcc3d18fe719bdb50e4338742e4f9/'],
    rawApiBase: 'https://gitlab.com/api/v4/projects/3kh0%2F3kh0-assets/repository/files/',
    attribution: 'Credit to 3kh0 (Echo) for the game asset library, and the individual game authors.',
    permissionNotice: 'https://gitlab.com/3kh0/3kh0-assets/-/blob/ff73bc4b150bcc3d18fe719bdb50e4338742e4f9/README.md',
  },
  precision: {
    repository: 'https://github.com/twitchmawwy/precisionclient',
    revision: 'fe27052133d5573fa130ecc00e77c4fe23ca426f',
    origins: [
      'https://cdn.jsdelivr.net/gh/twitchmawwy/precisionclient@fe27052133d5573fa130ecc00e77c4fe23ca426f/',
      'https://raw.githubusercontent.com/twitchmawwy/precisionclient/fe27052133d5573fa130ecc00e77c4fe23ca426f/',
    ],
    attribution: 'Precision Client by EtcherFX, based on the web port by LAX1DUDE. CC BY-NC 4.0.',
    license: 'CC-BY-NC-4.0',
    licenseNotice: 'https://github.com/twitchmawwy/precisionclient/blob/fe27052133d5573fa130ecc00e77c4fe23ca426f/LICENSE',
    replacements: {
      'originals/precision': 'The client files are absent from the current PeteZah game library.',
      'echo/mcje': 'The original uses a Java applet, unsupported by modern browsers; this is a browser client replacement.',
    },
  },
  gn: {
    repository: 'https://github.com/gn-math/html',
    revision: 'fecb3ca5e05c92f4d9b38f7b81b6eb20c18c0f4f',
    origins: [
      'https://cdn.jsdelivr.net/gh/gn-math/html@fecb3ca5e05c92f4d9b38f7b81b6eb20c18c0f4f/',
      'https://raw.githubusercontent.com/gn-math/html/fecb3ca5e05c92f4d9b38f7b81b6eb20c18c0f4f/',
    ],
    attribution: 'gn-math and the individual game authors; per-game notices are preserved.',
  },
  cg: {
    repository: 'https://github.com/genizy/cg-rip',
    revision: '151f9126d2ccb6b81dc0f93155e305900d423d5c',
    origins: ['https://raw.githubusercontent.com/genizy/cg-rip/151f9126d2ccb6b81dc0f93155e305900d423d5c/'],
    attribution: 'Game files collected by genizy; copyright remains with the individual game authors. Original notices are preserved.',
    replacements: 'Same-origin game asset mirror for the unavailable jsDelivr genizy/cg-rip CDN base URLs.',
  },
  ports: {
    repository: 'https://github.com/genizy/web-port',
    revision: 'a8bea5fd11f88e5a9192857f434e299c40efe7e6',
    origins: ['https://raw.githubusercontent.com/genizy/web-port/a8bea5fd11f88e5a9192857f434e299c40efe7e6/'],
    attribution: 'Browser ports collected by genizy; original game and port authors retain their copyrights and notices.',
    replacements: { 'ultrakill/index.html': 'Use the matching pinned port wrapper; the older Games-lib wrapper refers to build hashes that no longer exist.' },
  },
  ugs: {
    repository: 'https://github.com/bubbls/UGS-Assets',
    revision: '9cf433220236bb0471ab3a68ec8fe3e0a2799e36',
    origins: ['https://raw.githubusercontent.com/bubbls/UGS-Assets/9cf433220236bb0471ab3a68ec8fe3e0a2799e36/'],
    attribution: 'Assets collected by bubbls; copyright remains with individual game authors. Original notices are preserved.',
  },
  crushed: {
    repository: 'https://github.com/the2amgamer/crushed-advendutrs',
    revision: 'ff28af234aa4a004d09e31f3e37db3fe591fc7e6',
    origins: ['https://raw.githubusercontent.com/the2amgamer/crushed-advendutrs/ff28af234aa4a004d09e31f3e37db3fe591fc7e6/'],
    attribution: 'Crushed Adventures files collected by the2amgamer; original game author notices are preserved.',
  },
});

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.swf': 'application/x-shockwave-flash', '.webmanifest': 'application/manifest+json',
};

// The source library uses a named HTML entrypoint for these games rather than
// index.html. Retain the catalog's stable URLs while serving the actual file.
const ECHO_ENTRYPOINTS = Object.freeze({
  backrooms2d: 'backrooms2d.html', balldodge: 'balldodge.html', bonkio: 'bonkio.html',
  checkers: 'checkers.html', chess: 'chess.html', dodge: 'dodge.html', doom: 'doom.html',
  dumbwaystodie: 'dumbwaystodie.html', 'fantasy-dash': 'Fantasy Dash.html',
  'flappy plane': 'Flappy Plane.html', geodashlite: 'geodashlite.html', geojump: 'index0021.html',
  'iron dash': 'Iron Dash.html', kirkaio: 'kirka.html', linerider: 'linerider.html',
  mcje: 'Mine.html', 'plants vs zombies 1': 'plants vs zombies.html',
  shogunshowdown: 'shogunshowdown.html', slitherio: 'slitherio.html', vex2: 'vex2.html',
  zigzag: 'zigzag.html',
});

export function gameAssetContentType(file) {
  return CONTENT_TYPES[path.posix.extname(file.replace(/\.(gz|br)$/i, '')).toLowerCase()] || 'application/octet-stream';
}

export function resolveGameAsset(requestPath) {
  let clean;
  try { clean = decodeURIComponent(requestPath.split('?')[0]); } catch { return null; }
  clean = clean.replace(/^\/storage\/ag(?=\/|$)/, '').replace(/^\/+/, '');
  if (!clean || /[\\\x00-\x1f\x7f]/.test(clean) || clean.split('/').some(p => p === '.' || p === '..')) return null;
  const slash = clean.indexOf('/');
  if (slash < 0) return null;
  const group = clean.slice(0, slash);
  let file = clean.slice(slash + 1);
  if (!file || file.endsWith('/')) file += 'index.html';
  if (group === 'echo') {
    // Java browser plug-ins no longer run. Use the supported browser port for
    // this Minecraft entry and all of its relative resource requests.
    if (file.startsWith('mcje/')) {
      let replacement = file.slice('mcje/'.length);
      if (replacement === 'Mine.html') replacement = 'index.html';
      return { source: 'precision', file: `web/${replacement}` };
    }
    const match = file.match(/^([^/]+)\/index\.html$/);
    if (match && ECHO_ENTRYPOINTS[match[1]]) file = `${match[1]}/${ECHO_ENTRYPOINTS[match[1]]}`;
    return { source: 'echo', file };
  }
  if (group === 'gn') return { source: 'gn', file };
  if (['cg', 'ports', 'ugs', 'crushed'].includes(group)) return { source: group, file };
  if (group === 'arsenic' || group === 'originals') {
    if (file === 'ultrakill/index.html') return { source: 'ports', file: 'ultrakill/index.html' };
    if (group === 'originals' && file.startsWith('precision/')) {
      return { source: 'precision', file: `web/${file.slice('precision/'.length)}` };
    }
    if (file === 'redball/index.html') file = 'redball/1.html';
    return { source: 'petezah', file };
  }
  return null;
}

// These public SDKs normally request ad networks. Keep the game-facing callbacks
// so commercial/rewarded break calls finish without displaying advertisements.
export const AD_FREE_SDK = `(() => {
  if (window.__pzAdFreeSdk) return;
  window.__pzAdFreeSdk = true;
  const noop = () => {};
  const done = () => Promise.resolve();
  const poki = {
    init: done, initWithVideoHB: done, commercialBreak: done,
    rewardedBreak: () => Promise.resolve(true), getLeaderboard: () => Promise.resolve([]),
    getSharableURL: () => Promise.resolve(location.href),
    getURLParam: key => new URLSearchParams(location.search).get(key) || '',
    displayAd: noop, destroyAd: noop, isAdBlocked: () => true,
  };
  window.PokiSDK = new Proxy(poki, { get: (target, key) => key in target ? target[key] : noop });
  const ad = { requestAd(type, callbacks = {}) { queueMicrotask(() => callbacks.adFinished?.()); },
    hasAdblock: () => Promise.resolve(true) };
  const game = { loadingStart: noop, loadingStop: noop, gameplayStart: noop, gameplayStop: noop,
    happytime: noop, inviteLink: () => location.href, showInviteButton: noop, hideInviteButton: noop };
  const user = { getUser: () => Promise.resolve(null), getUserToken: () => Promise.resolve(null),
    isUserAccountAvailable: false, addAuthListener: noop, removeAuthListener: noop };
  window.CrazyGames = { SDK: { init: done, environment: 'local', ad, game, user, data: {
    getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key), clear: () => localStorage.clear() } } };
  window.cpmstarAPI = noop;
  const unityCallback = (method, value) => {
    const instance = window.gameInstance || window.unityInstance;
    try { if (instance?.SendMessage) instance.SendMessage('MainMenuManagers', method, value ?? ''); } catch {}
  };
  window.InitRV = () => queueMicrotask(() => unityCallback('RvReady'));
  window.showRV = () => queueMicrotask(() => unityCallback('RvWatchComplete', 'true'));
  window.requestNewAd = () => queueMicrotask(() => unityCallback('OnWebCallback'));
  window.unityAdFinishedCallback = window.requestNewAd;
  window.checkAdBlock = done;

  // Stop known ad and analytics requests made by game loaders after startup.
  // Game assets, multiplayer connections and other public resources are untouched.
  const blocked = /(?:googletagmanager\\.com|google-analytics\\.com|googlesyndication\\.com|doubleclick\\.net|cpmstar\\.com|ultra-rv\\.com|monetag|adinplay|adsterra|a-ads\\.com|adsbygoogle)/i;
  const rejects = url => blocked.test(String(url || ''));
  const originalFetch = window.fetch?.bind(window);
  if (originalFetch) window.fetch = (input, init) => rejects(input?.url || input)
    ? Promise.resolve(new Response(null, { status: 204 })) : originalFetch(input, init);
  const append = Node.prototype.appendChild;
  Node.prototype.appendChild = function(node) {
    if (rejects(node?.src || node?.href)) return node;
    return append.call(this, node);
  };
  const insert = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function(node, reference) {
    if (rejects(node?.src || node?.href)) return node;
    return insert.call(this, node, reference);
  };
})();`;

const AD_OR_ANALYTICS = /(?:googletagmanager\.com|google-analytics\.com|googlesyndication\.com|doubleclick\.net|adsbygoogle|monetag|adinplay|adsterra|a-ads\.com|plausible\.io|statcounter\.com|googleAnalytics\.js|\/js\/main\.js(?:[?#]|$)|storage\/js\/cloak\.js)/i;
const SDK_SCRIPT = /(?:sdk\.poki\.com|poki-sdk[^/]*\.js|sdk\.crazygames\.com|crazygames-sdk[^/]*\.js|IronSourceRV\.js|cpmstar\.js|ima3\.js|adblockManager\.js)/i;

// These game pages were copied with external <base> elements. The site's
// base-uri 'self' policy rejects them, and jsDelivr no longer serves genizy's
// repositories. Mirror only these known libraries, with the CG source pinned
// above, so every relative script/fetch/CSS URL keeps the same origin and MIME.
export function rewriteGameBaseUrls(input, asset = {}) {
  return input.replace(/(<base\b[^>]*\bhref\s*=\s*)(["'])([^"']+)\2/gi, (whole, before, quote, href) => {
    let url;
    try { url = new URL(href, 'https://game-assets.invalid'); } catch { return whole; }
    if (url.protocol !== 'https:') return whole;
    const localGame = asset.source === 'petezah' ? asset.file?.split('/')[0] : null;
    if ((localGame === 'bowmasters' && url.hostname === 'rawcdn.githack.com'
      && url.pathname === '/bubbls/youtube-playables/main/bowmasters/')
      || (localGame === 'tiny-fishing' && url.hostname === 'm.coolmathgames.com'
      && url.pathname === '/sites/default/files/public_games/33145/')) {
      return `${before}${quote}/storage/ag/arsenic/${localGame}/${quote}`;
    }
    if (url.hostname !== 'cdn.jsdelivr.net') return whole;
    const mirrors = [
      ['cg', /^\/gh\/genizy\/cg-rip@[^/]+\/(.*)$/],
      ['ports', /^\/gh\/genizy\/web-port@[^/]+\/(.*)$/],
      ['ugs', /^\/gh\/bubbls\/UGS-Assets@[^/]+\/(.*)$/],
      ['crushed', /^\/gh\/the2amgamer\/crushed-advendutrs(?:@[^/]+)?\/(.*)$/],
    ];
    for (const [source, pattern] of mirrors) {
      const match = url.pathname.match(pattern);
      if (match) return `${before}${quote}/storage/ag/${source}/${match[1]}${quote}`;
    }
    if (localGame === 'drive-mad'
      && /^\/gh\/genizy\/dmad-poki@[^/]+\/$/.test(url.pathname)) {
      // This deleted repository's complete webapp is already included in the
      // pinned PeteZah Games-lib source; retain its existing relative layout.
      return `${before}${quote}/storage/ag/arsenic/drive-mad/${quote}`;
    }
    return whole;
  });
}

export function sanitizeGameHtml(input, asset = {}) {
  let output = rewriteGameBaseUrls(input, asset).replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (whole, attributes, body) => {
    const src = attributes.match(/\bsrc\s*=\s*(['"])(.*?)\1/i)?.[2] || '';
    if (SDK_SCRIPT.test(src)) return '<script src="/storage/ag/sdk/ad-free.js"></script>';
    if (AD_OR_ANALYTICS.test(src) || /\bgtag\s*\(|\bga\s*\(\s*['"](?:create|send)|\badsbygoogle\b/.test(body)) return '';
    if (/\.cpmstar\.com\/cached\/zonefiles/.test(body)) return '';
    // Known gn-math ad-loader fingerprint: creates random DOM ad probes and
    // reloads when probes disappear. Leave unrelated obfuscated game code alone.
    if (body.length > 5000 && /new TextDecoder\s*\(/.test(body) && /crypto\s*\[/.test(body)
      && /setInterval\s*\(/.test(body) && /location\s*\[/.test(body)) return '';
    return whole;
  }).replace(/(["'])\/static\/embed\.html#/g, '$1/embed.html#');
  if (asset.source === 'echo' && asset.file?.startsWith('geodashlite/')) {
    output = output.replace(/(["'])\/(themes|rs)\//g, '$1/storage/ag/echo/geodashlite/$2/');
  }
  const bootstrap = '<script src="/storage/ag/sdk/ad-free.js"></script><style>ins.adsbygoogle,.adsbox,[id^="div-gpt-ad"]{display:none!important}</style>';
  if (/<head\b[^>]*>/i.test(output)) return output.replace(/<head\b[^>]*>/i, match => match + bootstrap);
  if (/<!doctype[^>]*>/i.test(output)) return output.replace(/<!doctype[^>]*>/i, match => match + bootstrap);
  return bootstrap + output;
}

export function createGameAssetsMiddleware({ fetchImpl = globalThis.fetch } = {}) {
  const htmlCache = new Map();
  let htmlCacheBytes = 0;
  const maxCacheBytes = 24 * 1024 * 1024;
  const pending = new Map();

  function remember(key, body) {
    const bytes = Buffer.byteLength(body);
    if (bytes > maxCacheBytes) return;
    if (htmlCache.has(key)) htmlCacheBytes -= htmlCache.get(key).bytes;
    htmlCache.delete(key);
    htmlCache.set(key, { body, bytes });
    htmlCacheBytes += bytes;
    while (htmlCacheBytes > maxCacheBytes && htmlCache.size) {
      const oldest = htmlCache.keys().next().value;
      htmlCacheBytes -= htmlCache.get(oldest).bytes;
      htmlCache.delete(oldest);
    }
  }

  async function upstream(asset, method = 'GET', range) {
    const source = GAME_ASSET_SOURCES[asset.source];
    const escaped = asset.file.split('/').map(encodeURIComponent).join('/');
    const urls = source.origins.map(origin => origin + escaped);
    if (source.rawApiBase) urls.unshift(`${source.rawApiBase}${encodeURIComponent(asset.file)}/raw?ref=${source.revision}`);
    let lastStatus = 502;
    for (const url of urls) {
      try {
        const response = await fetchImpl(url, {
          // Byte ranges must address the original file representation. A CDN
          // can otherwise range its Brotli/gzip representation, and decoding a
          // partial compressed stream cannot preserve bytes or Content-Range.
          method, headers: { ...(range ? { Range: range } : {}), 'Accept-Encoding': 'identity', 'User-Agent': 'PeteZah-AdFree/1.0' },
          signal: AbortSignal.timeout(/\.html?$/i.test(asset.file) ? 60000 : 300000), redirect: 'follow',
        });
        if (response.ok) return response;
        lastStatus = response.status;
        await response.body?.cancel();
      } catch { /* Try the independently hosted pinned copy. */ }
    }
    const error = new Error('The game asset host did not return this file.');
    error.status = lastStatus === 404 ? 404 : 502;
    throw error;
  }

  return async function gameAssets(req, res, next) {
    if (!['GET', 'HEAD'].includes(req.method)) return next();
    const requestPath = req.path || req.url;
    if (requestPath === '/sdk/ad-free.js' || requestPath === '/storage/ag/sdk/ad-free.js') {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.type('application/javascript').send(req.method === 'HEAD' ? '' : AD_FREE_SDK);
    }
    if (requestPath === '/sources.json' || requestPath === '/storage/ag/sources.json') {
      return res.json(GAME_ASSET_SOURCES);
    }
    // Fortnite is NVIDIA's cloud game, so it needs NVIDIA's own account/session.
    if (requestPath === '/apps/geforce/index.html' || requestPath === '/storage/ag/apps/geforce/index.html') {
      return res.type('text/html').send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fortnite · GeForce NOW</title><style>body{margin:0}iframe{width:100vw;height:100vh;border:0}</style><iframe allow="fullscreen;gamepad;autoplay;clipboard-write" allowfullscreen src="/embed.html#https://play.geforcenow.com/"></iframe>');
    }
    const asset = resolveGameAsset(requestPath);
    if (!asset) return next();
    const type = gameAssetContentType(asset.file);
    const cacheKey = `${asset.source}/${asset.file}`;
    res.setHeader('Content-Type', type);
    // HTML contains the current compatibility fixes and source routes. Keep
    // server-side caching, but revalidate browser copies after a deployment.
    res.setHeader('Cache-Control', type.startsWith('text/html') ? 'no-cache, max-age=0, must-revalidate' : 'public, max-age=86400, stale-while-revalidate=604800');
    res.setHeader('X-Game-Source', GAME_ASSET_SOURCES[asset.source].repository);
    try {
      if (type.startsWith('text/html')) {
        let body = htmlCache.get(cacheKey)?.body;
        if (body === undefined) {
          if (!pending.has(cacheKey)) {
            const promise = upstream(asset).then(async response => {
              const sanitized = sanitizeGameHtml(await response.text(), asset);
              remember(cacheKey, sanitized);
              return sanitized;
            }).finally(() => pending.delete(cacheKey));
            pending.set(cacheKey, promise);
          }
          body = await pending.get(cacheKey);
        }
        res.setHeader('Content-Length', Buffer.byteLength(body));
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      if (SDK_SCRIPT.test(asset.file)) return res.end(req.method === 'HEAD' ? undefined : AD_FREE_SDK);
      const response = await upstream(asset, req.method, req.headers.range);
      res.status(response.status);
      for (const header of ['content-range', 'accept-ranges', 'etag', 'last-modified']) {
        const value = response.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      // fetch decompresses HTTP Content-Encoding transparently. Only apply an
      // encoding for precompressed build files served as ordinary binary blobs.
      if (/\.(gz|br)$/i.test(asset.file) && !response.headers.get('content-encoding')) {
        res.setHeader('Content-Encoding', asset.file.endsWith('.br') ? 'br' : 'gzip');
      }
      if (req.method === 'HEAD' || !response.body) return res.end();
      await pipeline(Readable.fromWeb(response.body), res);
    } catch (error) {
      if (res.headersSent) return res.destroy();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(error.status || 502).type('text/plain').send('This game asset is temporarily unavailable. Please try again.');
    }
  };
}
