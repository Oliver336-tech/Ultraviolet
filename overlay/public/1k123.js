// Based on MercuryWorkshop/Scramjet-App public/sw.js at
// f6f83cbc93091e47b9c357eb00ea289828aedf94 (AGPL-3.0).
var base = self.location.pathname.replace(/[^/]*$/, '');
importScripts(base + 'scram/scramjet.all.js');
var { ScramjetServiceWorker } = $scramjetLoadWorker();
var scramjet = new ScramjetServiceWorker();
// Start before a controller message can populate config and make the bundled
// loadConfig return early without initializing its codec and rewriter WASM.
var startup = scramjet.loadConfig();
var advertisingHosts = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
  'amazon-adsystem.com', 'adnxs.com', 'pubmatic.com', 'criteo.com',
  'criteo.net', 'rubiconproject.com', 'adsrvr.org', '3lift.com',
  'fafvertizing.crazygames.com',
];
var decoderSource;
var decodeDestination;

function decodeProxyDestination(raw) {
    var requestUrl = new URL(raw);
    if (requestUrl.origin !== self.location.origin || !requestUrl.pathname.startsWith(scramjet.config.prefix)) return null;
    // Use the controller's configured codec, as the canonical engine does.
    // Its module/worker query markers are separate from the encoded target.
    if (decoderSource !== scramjet.config.codec.decode) {
      decoderSource = scramjet.config.codec.decode;
      decodeDestination = Function('return ' + decoderSource)();
    }
    return new URL(decodeDestination(requestUrl.pathname.slice(scramjet.config.prefix.length)));
}

function isAdvertisingRequest(request) {
  try {
    var destination = decodeProxyDestination(request.url);
    if (!destination) return false;
    var host = destination.hostname.toLowerCase();
    return advertisingHosts.some((blocked) => host === blocked || host.endsWith('.' + blocked));
  } catch (_) {
    return false;
  }
}

function referrerForDestination(source, destination, policy) {
  var referrer = new URL(source);
  referrer.username = '';
  referrer.password = '';
  referrer.hash = '';
  var sameOrigin = referrer.origin === destination.origin;
  var downgrade = referrer.protocol === 'https:' && destination.protocol === 'http:';
  var origin = referrer.origin + '/';
  switch (policy) {
    case 'no-referrer': return '';
    case 'unsafe-url': return referrer.href;
    case 'origin': return origin;
    case 'same-origin': return sameOrigin ? referrer.href : '';
    case 'origin-when-cross-origin': return sameOrigin ? referrer.href : origin;
    case 'strict-origin': return downgrade ? '' : origin;
    case 'no-referrer-when-downgrade': return downgrade ? '' : referrer.href;
    case 'strict-origin-when-cross-origin':
    default: return sameOrigin ? referrer.href : downgrade ? '' : origin;
  }
}

scramjet.addEventListener('request', (event) => {
  var request = event.originalRequest;
  if (!request || request.mode !== 'navigate') return;
  event.requestHeaders['sec-fetch-dest'] = request.destination || 'empty';
  event.requestHeaders['sec-fetch-mode'] = request.mode;
  // No clientId exists for a newly navigated iframe. Restore only the context
  // actually supplied by the browser, using its referrer policy upstream.
  if (request.referrerPolicy === 'no-referrer') delete event.requestHeaders.referer;
  var parent;
  try { parent = decodeProxyDestination(request.referrer); } catch (_) { return; }
  if (!parent || !['https:', 'http:'].includes(parent.protocol)) return;
  var referrer = referrerForDestination(parent, event.url, request.referrerPolicy);
  if (referrer) event.requestHeaders.referer = referrer;
  else delete event.requestHeaders.referer;
});

function isolatedResponse(response) {
  // These responses are created inside the worker, so the backend's isolation
  // headers cannot reach them. Keep rewritten frames and worker resources
  // compatible with our isolated parent without modifying their content. A
  // service worker's own crossOriginIsolated flag does not describe its client.
  var headers = new Headers(response.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers,
  });
}

async function handleRequest(event) {
  await startup;
  await scramjet.loadConfig();
  if (isAdvertisingRequest(event.request)) return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
  if (scramjet.route(event)) return isolatedResponse(await scramjet.fetch(event));
  return fetch(event.request);
}
self.addEventListener('fetch', (event) => event.respondWith(handleRequest(event)));
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
