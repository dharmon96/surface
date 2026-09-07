# Surface on the MantaGlow hub

Surface is a **downloadable, offline-first** MantaGlow app. It never needs the hub to run a show; the hub gives it an
account (sign-in), a project list that follows you between machines, and a listing on mantaglow.com with the download.

## What the desktop app talks to (all existing hub endpoints — nothing new server-side)

| Purpose | Endpoint | Notes |
|---|---|---|
| who am I | `GET /api/hub/users/me` | header `x-hub-session-token: <token>` (desktop fallback the hub already accepts for Tauri apps) |
| project list | `GET /api/data/surface` | previews (`preview.name` = value.name) |
| one project | `GET/PUT/DELETE /api/data/surface/project:<id>` | PUT body = `{ name, doc, meta, updatedAt }` (the ShowDoc lives in `doc`) |

The token is the part before the dot of Better Auth's `__Secure-better-auth.session_token` cookie. The Electron shell opens
`https://mantaglow.com/sign-in` in its own window, reads the (HttpOnly) cookie from the main process once it appears, and
hands the token to the local server (`POST /api/hub/token`), which verifies it with `/users/me` and keeps it in
`<userData>/hub.json` so the app stays signed in offline. Sign out clears both.

Access is decided by the hub: `/api/data/surface` returns 403 unless `hasAppAccess(userId, "surface", orgId)` — so the app
must be seeded and the user (or their org) granted it. Until then the dashboard shows the 403 text and everything still
works locally.

## Listing Surface on mantaglow.com — add to `web/scripts/seed-apps.ts` (APPS array)

```ts
  {
    slug: "surface",
    name: "Surface",
    description: "Show-control console for live-event graphics — bout sheet in, Resolume / disguise / Companion out, or run the cues itself. Desktop app, works offline.",
    subdomain: "surface.mantaglow.com",
    tier: "ai",                      // same tier as ShowCall
    iconName: "MonitorPlay",
    sortOrder: "8",
    hasOffline: true,                // the download/offline flag the hub already supports
    primaryCategory: "live_events",
    categories: ["live_events"],
    phase: "show",
  },
```

(Entry added 7 Sep 2026, together with `src/lib/app-metadata.ts`, `app/config/app-styles.ts` and the marketing page.)
`deploy.sh darianharmon-site` now runs `seed-apps` after migrations, so a push to `web` lists Surface; `npm run db:seed-apps` does it by hand.

## Downloads and releases

Installers are built by GitHub Actions (`.github/workflows/release.yml`) — nothing is built on the droplet:

```
git tag v0.1.0 && git push --tags     # → GitHub Release with Surface-Setup-win-x64.exe, Surface-mac-arm64.dmg, Surface-mac-x64.dmg
```

`surface.mantaglow.com/download/win|mac|mac-intel` are Caddy redirects (darian-infra/Caddyfile) to
`github.com/dharmon96/surface/releases/latest/download/<fixed name>`, so the hub's marketing page
(`web/app/(marketing)/apps/surface/page.tsx`) never needs touching for a new version. Builds are unsigned until a
certificate is added (CSC_LINK / CSC_KEY_PASSWORD secrets; APPLE_ID for notarization). Local: `npm run dist:win`.

Access: org owners/admins pass `hasAppAccess` automatically once the app row exists; other users need a `userAppAccess`
row (admin console) — the deploy script now seeds apps on every hub deploy, so pushing `web` is enough.

## Local layout (Electron `userData`, e.g. `%APPDATA%\Surface`)

```
projects/<id>/show.json                 the ShowDoc — source of truth while offline
projects/<id>/show.conflict-<ts>.json   the cloud copy when both sides changed (yours won)
projects/index.json                     list + sync state (local · synced · ahead · conflict · error)
active.json                             which project opens on launch
hub.json                                session token + who (mode 600)
surface.config.json                     adapters (mock / resolume / disguise / companion)
```

Sync is last-write-wins per project on `updatedAt`, explicit ("Sync now" or right after sign-in) — never in the middle of a
show. Delete offers "here + account" when signed in.
