# PeteZah Games — Ad-Free Edition

Modified 1 October 2026 from https://github.com/PeteZah-Games/PeteZahGames
at upstream commit `819f1fdd0c4b67763973ac3555189f7ca9121155`.
This is an independent modified edition, under AGPL-3.0-only. The upstream
license is in `LISCENSE`; copyright notices are retained.

## Changes

- Removed site-owned banner, interstitial, native and video ads, advertising
  network requests and injected Google tracking. Games skip advertising gates.
- Restored the local game destinations through pinned source providers.
  Known advertising loaders are sanitized and ad SDK callbacks remain usable.
  `/storage/ag/sources.json` describes per-game sources, credits and the obsolete
  Minecraft Java applet's replacement with a browser client.
- Built the local Rust Mochi proxy and installed the Firefox browser VM assets.
- Added durable PostgreSQL accounts, sessions, settings and profile uploads.
- Removed first-signup administrator access. Owner access requires verification.
- Fixed proxy path rewriting, popup handling, AI conversation loading and type
  errors. Unsupported Tor and geographic relay claims were removed.
- Replaced the renamed, floating proxy build and legacy embed launchers with
  the official MercuryWorkshop/Scramjet-App setup at commit
  `f6f83cbc93091e47b9c357eb00ea289828aedf94`: Scramjet 1.1.0, BareMux 2.1.9,
  libcurl transport 1.5.2 and Wisp 0.4.1, with locked package integrity hashes.
  The demo, pinned Scramjet package and libcurl transport ship AGPL-3.0 license
  files; BareMux ships an MIT license. Scramjet 1.1.0's package metadata says MIT,
  which differs from its shipped license file. The vendor step preserves each
  actual license at `/scram/LICENSE`, `/baremux/LICENSE` and `/libcurl/LICENSE`.
  Catalogue wrappers recover the original publisher URL and use this same runtime.
- Added a small, reproducible compatibility hook to the pinned Scramjet bundle.
  Its DOM-created module scripts now use the same `?type=module` URL as static
  and dynamic imports, so cyclic game modules share one instance. This fixes
  CrazyGames gameframe's duplicate React dispatcher error. The vendor step
  checks the upstream bundle hash and single client export before copying and
  appending the hook; canonical names, rewriter WASM and TLS validation stay
  unchanged. A cold service worker also begins its actual rewriter setup before
  controller messages can skip initialization. Synthetic proxy responses carry
  matching COOP, COEP and CORP headers under this edition's isolation policy, so proxied
  game frames and worker resources can load inside the isolated application.
- Restored actual browser navigation metadata when a new iframe has no
  `clientId`. A checked vendor insertion exposes the original Request on the
  existing runtime request event. The worker preserves its real destination and
  decodes its actual parent referrer, applying the browser's referrer policy
  before transport. No publisher hosts, Origin headers, cookies or site signals
  are invented; downgrade and no-referrer privacy rules remain effective.
- Proxy requests to known advertising hosts are answered locally before any
  external transport request, including CrazyGames' separate
  `fafvertizing.crazygames.com` ad loader. The filter decodes destinations with
  the configured runtime codec and matches host boundaries. Publisher game
  files, game SDKs, Google fonts and other ordinary resources retain their normal
  proxy behavior. This covers known advertising networks, not every possible
  advertisement embedded by an external provider.
- Public home, catalogue and browsing paths no longer require a universal
  agreement overlay. Account signup keeps its consent requirements. CAPTCHA
  challenges respond to observed abuse; server bans and transport protections
  remain enabled. Proxy startup failures now display a useful error.

## Deployment and source

The deployment branch contains a public overlay and `bootstrap-render.mjs`.
It clones the pinned upstream revision, applies the overlay, installs locked
 dependencies, compiles Rust and the frontend, and creates the complete source
 download. All network users can obtain it at `/source.tar.gz` and `/edition`.
The offer excludes runtime secrets, accounts, uploads and installed build output.

Render build command: `node bootstrap-render.mjs`
Render start command: `cd app && node scripts/start-render.mjs`
These commands apply to the deployment branch's overlay checkout.

The `/source.tar.gz` download contains the complete assembled application, so
it does not require `overlay.json` or the overlay bootstrap step. After extracting
it, install Node.js 22 or newer and run these commands from its root directory:

```sh
npm ci --include=dev --ignore-scripts
npm rebuild bcrypt better-sqlite3
npm run postinstall
node scripts/render-build.mjs
node scripts/start-render.mjs
```

The build script installs the pinned Rust toolchain when necessary, builds Mochi
with `Cargo.lock`, downloads the Firefox VM assets, and builds the frontend.
Before starting, set `TOKEN_SECRET` and `SESSION_SECRET` to independently
generated values of at least 24 characters, and set `ADMIN_EMAIL` to the owner's
account address. For durable PostgreSQL storage, configure `DATABASE_URL` and a
database role that can create and use tables in `DATABASE_SCHEMA` (default:
`petezah`). Connections use TLS by default; a custom CA can be supplied through
`DATABASE_SSL_CA`. Without `DATABASE_URL`, the backend uses local SQLite storage.
Configure `PUBLIC_ORIGIN` and any external integrations listed below for your
deployment. Supply your own credentials; the source download contains none of
the running deployment's secrets or account data.

The free service uses a private `petezah` schema in an existing Supabase project.
No passwords or provider keys belong in this repository.

## External integrations

AI requires the owner's `GROQ_API_KEY`. Movie metadata requires `TMDB_API_KEY`.
Email verification requires `RESEND_API_KEY`, verified `EMAIL_FROM`, and the
 deployed `PUBLIC_ORIGIN`. Missing integrations return explicit unavailable
 responses. Do not treat unavailable providers as working integrations.

Remote games, multiplayer servers, movie players, chat and music are controlled
by external providers. Their uptime, accounts and advertisements cannot be
 guaranteed by this edition. All catalog entries have not been individually played.
Free Render services sleep after inactivity and have shared quotas; free Supabase
 storage and database limits also apply. See the original license for warranty terms.

## Game availability

Drive Mad is excluded from this edition's catalogue because the game redirects this host to its publisher's sitelock page. The publisher's restriction is preserved. Other game fixes retain the original author notices and use pinned asset sources.

Tag's original `media/tagged.webm` is a zero-byte placeholder in the pinned source. This edition serves a short silent Opus WebM at that exact path so the game's audio decoder and tagged-sound handle can finish normally. The missing original tag sound is not restored; the other eight original audio clips are retained.
