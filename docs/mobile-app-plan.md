# River Cleanup Mobile Expansion Plan (iOS + Android)

## Goal
Ship the platform as:
- Web app (existing)
- iOS app
- Android app

while preserving one backend (Supabase) and maximizing code sharing.

## Recommendation Summary
- Keep the current web app on React + Vite.
- Build a new mobile app with Expo (React Native).
- Extract shared business/domain logic into common modules.
- Do not attempt a direct in-place Leaflet to React Native conversion.

## Why This Approach
The current implementation is web and DOM heavy, with map behavior tied to Leaflet and browser APIs. A parallel mobile app with shared logic is lower risk than forcing one unchanged codebase to run across web and native.

## Target Architecture

### Apps
- apps/web: existing Vite app
- apps/mobile: Expo React Native app (iOS + Android)

### Shared Packages
- packages/domain:
  - type normalization
  - validation/parsing
  - retry/timeout helpers
  - forecast/tide/EA data transforms
- packages/api:
  - Supabase query wrappers
  - API client helpers (W3W, weather, EA)
- packages/ui-tokens (optional):
  - color, spacing, typography tokens (platform-specific rendering)

## Mobile Tech Choices (Proposed)
- Framework: Expo + React Native
- Maps: react-native-maps (or Mapbox SDK if advanced overlay editing is required)
- Auth: Supabase Auth with mobile deep linking
- Storage/cache: AsyncStorage (instead of localStorage)
- Image picking/upload: expo-image-picker + expo-image-manipulator
- Geolocation: expo-location
- Linking/share: Expo Linking + Share APIs

## Feature Parity Plan

### Phase 1 (MVP parity)
- View map and existing markers
- Filter by type/status
- View item details and story data
- Add item with location + photo
- Edit/delete for owner accounts
- Tide/weather/flood readouts
- Auth sign in/sign out

### Phase 2 (advanced parity)
- Historic overlays
- Overlay calibration/editor tooling
- Contributor and POI advanced panels
- Public report flow parity
- Better offline behavior/caching

### Phase 3 (mobile polish)
- Push notifications (if needed)
- Offline-first sync improvements
- Performance/battery optimization
- Accessibility and UX polish

## Estimated Effort

### Engineering Time
- Discovery and architecture: 1-2 weeks
- Shared logic extraction/refactor: 2-4 weeks
- Mobile MVP build: 4-8 weeks
- QA/device testing/store prep: 2-3 weeks

Expected total:
- Lean MVP: 8-12 weeks
- Strong parity: 12-20 weeks

### Rough Cost Range
- Depends on team/rate and final scope.
- Typical MVP to strong parity usually lands in medium 4-figure to low/mid 5-figure GBP and can go higher with advanced overlay tooling and polish.

## Publishing and Ongoing Costs
- Apple Developer Program: 99 USD/year
- Google Play Console: 25 USD one-time
- Existing backend/services continue:
  - Supabase usage
  - Map tile/API usage
  - Storage and egress

## Delivery Milestones
1. Milestone A: Planning + technical spike
- Decide map library
- Confirm auth + deep link strategy
- Build one screen spike with live Supabase data

2. Milestone B: Shared logic extraction
- Move pure logic to shared modules
- Keep web app behavior unchanged

3. Milestone C: Mobile MVP implementation
- Core map + CRUD + auth + photo flow
- Internal builds (TestFlight + Play Internal Testing)

4. Milestone D: Hardening + store submission
- QA, permissions, privacy policy
- Store screenshots/metadata
- Submit and resolve review feedback

## Key Risks
- Advanced historic overlay editing may require custom native map work
- OAuth/deep-link edge cases on iOS/Android
- Large single-file web architecture increases extraction time
- Device-specific camera/gallery/geolocation behavior

## Definition of Done (v1)
- iOS and Android apps available in stores
- Owner can authenticate and manage records
- Public users can view map data and details
- Stable photo upload and geolocation on real devices
- No regressions in existing web app

## Immediate Next Actions
1. Scaffold Expo mobile app in a parallel folder.
2. Extract first shared utility module (pure logic only).
3. Implement one complete mobile flow: sign in -> map -> item detail.
