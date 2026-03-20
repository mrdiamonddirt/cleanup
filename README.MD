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