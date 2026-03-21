# 🌊 River Bank Cleanup Tracker

An interactive mapping tool designed to track and manage environmental cleanup efforts along a local river bank.

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
- A scheduled GitHub Actions workflow updates the JSON daily and redeploys the site

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