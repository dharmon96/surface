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

(Entry already added to the file on 7 Sep 2026.) Seed it with `npm run db:seed-apps` in `web/` — the script upserts, so the
other apps are untouched. Then grant access the same way as the other apps (`userAppAccess` with `offlineAccess: true`).

## Downloads

Release artifacts (electron-builder, not yet wired): `Surface-<version>-win-x64.exe` (NSIS), `Surface-<version>-mac-arm64.dmg`.
Put them on the app's hub page; the app checks nothing at start-up (no auto-update yet), so the hub page is the update channel.

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
