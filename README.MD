# 🌊 River Bank Cleanup Tracker

An interactive mapping tool built to track and coordinate a real, ongoing cleanup effort on a stretch of my local river — the River Lune. This project exists in partnership with the physical cleanup work itself: the app is actively used to log debris, monitor what's been recovered, and plan future sessions around the tides.

The goal is simple: pull trolleys, bikes, and other rubbish out of the river and dispose of them responsibly — and show that anyone, including kids, can make a meaningful difference to their local environment. If the mapped stretch of river runs out of locations to log, the project scope will expand to cover more of the river.

> *Created to demonstrate how accessible environmental action can be — both the technical side and the getting-out-there side.*

## 🛠️ Tech Stack
- **Frontend:** React, Vite, Leaflet.js
- **Backend:** PostgreSQL via Supabase
- **Mapping:** Custom Coordinate Reference System (CRS.Simple) using high-res aerial imagery.

## 🚀 Key Features
- **Custom Mapping:** Uses an aerial drone/satellite photo as the map base rather than standard tiles, allowing for high-precision plotting in a specific localized area.
- **Real-time Tracking:** Log items (Trolleys, Bikes, etc.) with a single click and persist coordinates to a SQL database.
- **State Management:** Track the recovery status of items with visual indicators (✅ vs ❌).
- **Impact Dashboard:** Real-time calculation of cleanup progress using filtered data arrays.

## 📐 Technical Implementation
To maintain the aspect ratio of the aerial imagery, I implemented a custom `CRS.Simple` coordinate system mapped to the image dimensions (1687x830). This ensures that markers stay pinned to exact pixel coordinates regardless of screen scaling.

## 🌊 Tide Data
- The Lancaster tide planner reads from [public/lancaster-tides.json](public/lancaster-tides.json)
- Refresh manually with `npm run update:tides`
- The updater now merges freshly fetched rows with the previous snapshot so chart coverage is less likely to drift out of range
- A scheduled GitHub Actions workflow refreshes the JSON once every 24 hours and redeploys the site

## 🔎 SEO Share Pages (Supabase Prerender)
- Build-time SEO page generation runs with `npm run generate:seo`.
- Generated files are written to `public/share/<item-id>/index.html`.
- Published POIs are generated to `public/poi/<slug>/index.html`.
- Each share page contains crawler-friendly Open Graph/Twitter metadata from Supabase item data.
- Human visitors can open the app directly with `?item=<id>` deep links.

### POI Schema (Phase 1)
- Initial SQL migration is in [supabase/migrations/20260401_create_pois.sql](supabase/migrations/20260401_create_pois.sql).
- This migration creates `pois` and `poi_images` with RLS policies.
- POIs can be marked with `is_historic` to identify historical references without splitting into a separate entity type.
- Until this migration is applied, POI page generation is skipped automatically while normal share-page generation still succeeds.

Auto rebuilds on GitHub Actions generate a `.env.production` file during the workflow. Any production `VITE_*` key used by the app needs to be configured in GitHub as part of that rebuild path.

Required repository secrets:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Sensitive optional repository secrets:

```env
VITE_MAPBOX_TOKEN=...
```

Repository variables for non-sensitive production config:

```env
SEO_SITE_URL=https://rivercleanup.co.uk
VITE_FACEBOOK_PAGE_RECIPIENT_ID=
VITE_COMMUNITY_EMAIL_ACCOUNT=
VITE_OWNER_GITHUB_LOGINS=mrdiamonddirt
VITE_OWNER_EMAILS=
VITE_OWNER_SUPABASE_IDS=
VITE_ENABLE_PUBLIC_REPORTS=true
```

If you add a new production `VITE_*` key, update both [`.github/workflows/refresh-lancaster-tides.yml`](.github/workflows/refresh-lancaster-tides.yml) and `.env.example` in the same change so the scheduled rebuild does not drop it.

## 🔐 Auth (GitHub + Owner Write Access)
- Sign-in uses Supabase Auth with the GitHub provider.
- Everyone can view the map data.
- Only owner accounts can add, edit, or delete locations.

Configure allowlists with Vite env vars:

```env
VITE_OWNER_GITHUB_LOGINS=mrdiamonddirt
VITE_OWNER_EMAILS=
VITE_OWNER_SUPABASE_IDS=
```

You can set one or more values in each variable as comma-separated lists. This keeps the current single-owner setup simple while leaving room to expand to additional maintainers later.

## ❤️ Support The Cleanup
If you want to help cover practical cleanup costs (rope, gloves, bags, and disposal trips), you can support the project here:

- https://buymeacoffee.com/rivercleanv

Every donation goes back into getting more rubbish out of the river safely and responsibly.