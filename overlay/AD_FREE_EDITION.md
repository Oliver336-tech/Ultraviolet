# PeteZah Games — Ad-Free Edition

Modified 30 September 2026 from https://github.com/PeteZah-Games/PeteZahGames
at upstream commit `819f1fdd0c4b67763973ac3555189f7ca9121155`.
This is an independent modified edition, under AGPL-3.0-only. The upstream
license is in `LISCENSE`; copyright notices are retained.

## Changes

- Removed site-owned banner, interstitial, native and video ads, advertising
  network requests and injected Google tracking. Games skip advertising gates.
- Restored the 445 local game destinations through pinned source providers.
  Known advertising loaders are sanitized and ad SDK callbacks remain usable.
  `/storage/ag/sources.json` describes per-game sources, credits and the obsolete
  Minecraft Java applet's replacement with a browser client.
- Built the local Rust Mochi proxy and installed the Firefox browser VM assets.
- Added durable PostgreSQL accounts, sessions, settings and profile uploads.
- Removed first-signup administrator access. Owner access requires verification.
- Fixed proxy path rewriting, popup handling, AI conversation loading and type
  errors. Unsupported Tor and geographic relay claims were removed.

## Deployment and source

The deployment branch contains a public overlay and `bootstrap-render.mjs`.
It clones the pinned upstream revision, applies the overlay, installs locked
 dependencies, compiles Rust and the frontend, and creates the complete source
 download. All network users can obtain it at `/source.tar.gz` and `/edition`.
The offer excludes runtime secrets, accounts, uploads and installed build output.

Render build command: `node bootstrap-render.mjs`
Render start command: `cd app && node scripts/start-render.mjs`
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
