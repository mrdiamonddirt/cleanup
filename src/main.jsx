import React, { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { createPortal } from "react-dom";
import w3wLogo from "./assets/w3w_logo.png";
import {
    MapContainer,
    TileLayer,
    Marker,
    Popup,
    CircleMarker,
    useMap,
    useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { hasSupabaseConfig, supabase } from "./supabaseClient";
import ContributorBusinessPanel from "./components/panels/ContributorBusinessPanel";
import PoiPanel from "./components/panels/PoiPanel";
import PoiCard from "./components/PoiCard";

// --- LEAFLET ICON FIX ---
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
let DefaultIcon = L.icon({
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;
// ------------------------

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || "";
const HAS_MAPBOX_TOKEN = Boolean(MAPBOX_TOKEN && MAPBOX_TOKEN.trim());
const MAPTILER_KEY = import.meta.env.VITE_MAPTILER_KEY || "";
const HAS_MAPTILER_KEY = Boolean(MAPTILER_KEY && MAPTILER_KEY.trim());
const HISTORIC_OVERLAY_DRAFTS_STORAGE_KEY = "cleanup-historic-overlay-drafts-v1";
const HISTORIC_OVERLAY_STATUS_DRAFT = "draft";
const HISTORIC_OVERLAY_STATUS_READY = "ready";
const HISTORIC_OVERLAY_AUTOSAVE_DEBOUNCE_MS = 700;
const LIVE_LOCATION_PANE_NAME = "live-location-pane";
const LIVE_LOCATION_PANE_Z_INDEX = 690;
const HISTORIC_OVERLAY_ATTRIBUTION =
    'Historic map &copy; <a href="https://maps.nls.uk/">National Library of Scotland</a> via <a href="https://www.maptiler.com/">MapTiler</a>';
// River Lune, Lancaster — adjust if needed
const RIVER_LUNE_CENTER = [54.052776, -2.801216];
const RIVER_LUNE_ZOOM = 15;

const compareHistoricOverlayLayers = (leftLayer, rightLayer) => {
    if (leftLayer.startYear !== rightLayer.startYear) {
        return leftLayer.startYear - rightLayer.startYear;
    }

    if (leftLayer.endYear !== rightLayer.endYear) {
        return leftLayer.endYear - rightLayer.endYear;
    }

    return leftLayer.label.localeCompare(rightLayer.label);
};

const PROVIDER_HISTORIC_OVERLAY_LAYERS = [
    {
        id: "lancaster-1900s",
        type: "tile",
        tileId: "uk-osgb1888",
        label: "Lancaster 1900s Overview",
        description: "Best all-round starting point for the River Lune corridor.",
        startYear: 1888,
        endYear: 1905,
        isDefault: true,
        attribution: HISTORIC_OVERLAY_ATTRIBUTION,
    },
    {
        id: "lancaster-one-inch-hills",
        type: "tile",
        tileId: "uk-osgb63k1885",
        label: "One-Inch Hills, 1885-1903",
        description: "Broader late-Victorian relief and route context across Lancaster.",
        startYear: 1885,
        endYear: 1903,
        attribution: HISTORIC_OVERLAY_ATTRIBUTION,
    },
    {
        id: "lancaster-six-inch",
        type: "tile",
        tileId: "uk-osgb10k1888",
        label: "Six-Inch Detail, 1888-1913",
        description: "Most detailed local land, field, and street context.",
        startYear: 1888,
        endYear: 1913,
        attribution: HISTORIC_OVERLAY_ATTRIBUTION,
    },
    {
        id: "lancaster-interwar",
        type: "tile",
        tileId: "uk-osgb1919",
        label: "Interwar Overview, 1920s-1940s",
        description: "Useful for comparing between the Edwardian and post-war landscape.",
        startYear: 1919,
        endYear: 1947,
        attribution: HISTORIC_OVERLAY_ATTRIBUTION,
    },
    {
        id: "lancaster-provisional",
        type: "tile",
        tileId: "uk-osgb25k1937",
        label: "Provisional Edition, 1937-1961",
        description: "Good mid-20th-century comparison for Lancaster approaches.",
        startYear: 1937,
        endYear: 1961,
        attribution: HISTORIC_OVERLAY_ATTRIBUTION,
    },
    {
        id: "lancaster-seventh-series",
        type: "tile",
        tileId: "uk-osgb63k1955",
        label: "Seventh Series, 1955-1961",
        description: "Post-war one-inch touring map view for roads, rail, and settlement change.",
        startYear: 1955,
        endYear: 1961,
        attribution: HISTORIC_OVERLAY_ATTRIBUTION,
    },
].sort(compareHistoricOverlayLayers);
const DEFAULT_HISTORIC_OVERLAY_ID =
    PROVIDER_HISTORIC_OVERLAY_LAYERS.find((layer) => layer.isDefault)?.id ||
    PROVIDER_HISTORIC_OVERLAY_LAYERS[0]?.id ||
    "";
const EARLIEST_HISTORIC_OVERLAY_YEAR = PROVIDER_HISTORIC_OVERLAY_LAYERS.reduce(
    (oldestYear, layer) => Math.min(oldestYear, layer.startYear),
    Number.POSITIVE_INFINITY,
);
const DEFAULT_HISTORIC_OVERLAY_OPACITY = 0.72;
const DEFAULT_HISTORIC_DRAFT_EDITOR_OPACITY = 0.62;

const buildHistoricDraftCornersFromBounds = (bounds) => {
    const normalizedBounds = normalizeHistoricOverlayBounds(bounds);
    if (!normalizedBounds) return null;

    const [[south, west], [north, east]] = normalizedBounds;
    return {
        nw: [north, west],
        ne: [north, east],
        se: [south, east],
        sw: [south, west],
    };
};

const deriveHistoricBoundsFromCorners = (corners) => {
    if (!corners) return null;

    const entries = [corners.nw, corners.ne, corners.se, corners.sw]
        .map((corner) => (Array.isArray(corner) ? [Number(corner[0]), Number(corner[1])] : null))
        .filter(Boolean);
    if (entries.length !== 4) return null;

    const lats = entries.map((corner) => corner[0]);
    const lngs = entries.map((corner) => corner[1]);
    if (![...lats, ...lngs].every((coordinate) => Number.isFinite(coordinate))) {
        return null;
    }

    return normalizeHistoricOverlayBounds([
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
    ]);
};

const normalizeHistoricOverlayCorner = (value) => {
    if (!Array.isArray(value) || value.length !== 2) return null;

    const latitude = Number(value[0]);
    const longitude = Number(value[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90) return null;
    if (!isFiniteCoordinate(longitude)) return null;

    return [latitude, longitude];
};

const normalizeHistoricOverlayCorners = (value, fallbackBounds = null) => {
    if (!value || typeof value !== "object") {
        return buildHistoricDraftCornersFromBounds(fallbackBounds);
    }

    const nextCorners = {
        nw: normalizeHistoricOverlayCorner(value.nw),
        ne: normalizeHistoricOverlayCorner(value.ne),
        se: normalizeHistoricOverlayCorner(value.se),
        sw: normalizeHistoricOverlayCorner(value.sw),
    };

    if (Object.values(nextCorners).every(Boolean)) {
        return nextCorners;
    }

    return buildHistoricDraftCornersFromBounds(fallbackBounds);
};

const HISTORIC_OVERLAY_DRAFT_TEMPLATES = [
    {
        id: "mackreth-1778",
        type: "image",
        label: "Mackreth Map, 1778",
        description: "Draft placement for the 1778 Mackreth Lancaster map.",
        startYear: 1778,
        endYear: 1778,
        imageUrl: "/historic_maps/lancasteruniversity Lancaster S. Mackreth 1778.jpg",
        sourceUrl: "",
        attribution: "",
        status: "draft",
        bounds: null,
        corners: null,
        editorOpacity: DEFAULT_HISTORIC_DRAFT_EDITOR_OPACITY,
        controlPoints: [],
    },
    {
        id: "docton-1684",
        type: "image",
        label: "Docton Map, 1684",
        description: "Draft placement for the 1684 Docton Lancaster map.",
        startYear: 1684,
        endYear: 1684,
        imageUrl: "/historic_maps/docton1684.jpg",
        sourceUrl: "",
        attribution: "",
        status: "draft",
        bounds: null,
        corners: null,
        editorOpacity: DEFAULT_HISTORIC_DRAFT_EDITOR_OPACITY,
        controlPoints: [],
    },
];

const buildHistoricOverlayTileUrl = (tileId) => {
    if (!tileId || !HAS_MAPTILER_KEY) return "";
    return `https://api.maptiler.com/tiles/${tileId}/{z}/{x}/{y}.jpg?key=${MAPTILER_KEY}`;
};

const isFiniteCoordinate = (value) => Number.isFinite(value) && value >= -180 && value <= 180;

const normalizeHistoricOverlayBounds = (value) => {
    if (!Array.isArray(value) || value.length !== 2) return null;

    const southWest = Array.isArray(value[0]) ? value[0] : null;
    const northEast = Array.isArray(value[1]) ? value[1] : null;
    if (!southWest || !northEast || southWest.length !== 2 || northEast.length !== 2) {
        return null;
    }

    const south = Number(southWest[0]);
    const west = Number(southWest[1]);
    const north = Number(northEast[0]);
    const east = Number(northEast[1]);

    if (![south, west, north, east].every((coordinate) => Number.isFinite(coordinate))) {
        return null;
    }

    if (south >= north || west >= east) return null;
    if (south < -90 || north > 90 || !isFiniteCoordinate(west) || !isFiniteCoordinate(east)) {
        return null;
    }

    return [
        [south, west],
        [north, east],
    ];
};

const normalizeHistoricOverlayControlPoints = (value) => {
    if (!Array.isArray(value)) return [];

    return value
        .map((point) => {
            const imageX = Number(point?.imageX);
            const imageY = Number(point?.imageY);
            const latitude = Number(point?.latitude);
            const longitude = Number(point?.longitude);
            if (![imageX, imageY, latitude, longitude].every((coordinate) => Number.isFinite(coordinate))) {
                return null;
            }

            return {
                imageX,
                imageY,
                latitude,
                longitude,
            };
        })
        .filter(Boolean);
};

const normalizeHistoricOverlayDraft = (draft, template) => {
    const baseTemplate = template || {};
    const nextDraft = isPlainObjectRecord(draft) ? draft : {};
    const imageUrl = typeof nextDraft.imageUrl === "string"
        ? nextDraft.imageUrl.trim()
        : baseTemplate.imageUrl || "";
    const sourceUrl = typeof nextDraft.sourceUrl === "string"
        ? nextDraft.sourceUrl.trim()
        : baseTemplate.sourceUrl || "";
    const attribution = typeof nextDraft.attribution === "string"
        ? nextDraft.attribution.trim()
        : baseTemplate.attribution || "";
    const status = nextDraft.status === HISTORIC_OVERLAY_STATUS_READY
        ? HISTORIC_OVERLAY_STATUS_READY
        : HISTORIC_OVERLAY_STATUS_DRAFT;
    const normalizedBounds = normalizeHistoricOverlayBounds(nextDraft.bounds || baseTemplate.bounds || null);
    const corners = normalizeHistoricOverlayCorners(
        nextDraft.corners || baseTemplate.corners || null,
        normalizedBounds,
    );
    const derivedBounds = deriveHistoricBoundsFromCorners(corners) || normalizedBounds;
    const editorOpacity = Number.parseFloat(nextDraft.editorOpacity);
    const isPublic = Boolean(nextDraft.isPublic);
    const publishedAt = typeof nextDraft.publishedAt === "string" ? nextDraft.publishedAt.trim() : "";
    const updatedAt = typeof nextDraft.updatedAt === "string" ? nextDraft.updatedAt.trim() : "";

    return {
        ...baseTemplate,
        ...nextDraft,
        id: baseTemplate.id || String(nextDraft.id || "").trim(),
        type: "image",
        label: baseTemplate.label || "Untitled historic draft",
        description: baseTemplate.description || "",
        startYear: Number(baseTemplate.startYear || 0),
        endYear: Number(baseTemplate.endYear || 0),
        imageUrl,
        sourceUrl,
        attribution,
        status,
        isPublic,
        publishedAt,
        updatedAt,
        bounds: derivedBounds,
        corners,
        editorOpacity: Number.isFinite(editorOpacity)
            ? Math.min(Math.max(editorOpacity, 0.1), 1)
            : Number(baseTemplate.editorOpacity || DEFAULT_HISTORIC_DRAFT_EDITOR_OPACITY),
        controlPoints: normalizeHistoricOverlayControlPoints(nextDraft.controlPoints),
    };
};

const normalizeHistoricOverlayDraftId = (value) => {
    const draftId = String(value || "").trim();
    if (!draftId) return "";

    const legacyDraftIdAliases = new Map([
        ["housman-clark-binns-1800-1825", "docton-1684"],
    ]);

    return legacyDraftIdAliases.get(draftId) || draftId;
};

const normalizeHistoricOverlaySourceRecord = (record) => {
    if (!isPlainObjectRecord(record)) return null;

    const normalizedId = normalizeHistoricOverlayDraftId(record.overlay_id || record.id);
    if (!normalizedId) return null;

    return {
        id: normalizedId,
        imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : undefined,
        sourceUrl: typeof (record.sourceUrl ?? record.source_url) === "string"
            ? String(record.sourceUrl ?? record.source_url)
            : undefined,
        attribution: typeof record.attribution === "string" ? record.attribution : undefined,
        status: record.status === HISTORIC_OVERLAY_STATUS_READY
            ? HISTORIC_OVERLAY_STATUS_READY
            : HISTORIC_OVERLAY_STATUS_DRAFT,
        isPublic: Boolean(record.isPublic ?? record.is_public),
        publishedAt: typeof (record.publishedAt ?? record.published_at) === "string"
            ? String(record.publishedAt ?? record.published_at)
            : "",
        updatedAt: typeof (record.updatedAt ?? record.updated_at) === "string"
            ? String(record.updatedAt ?? record.updated_at)
            : "",
        bounds: record.bounds ?? null,
        corners: record.corners ?? null,
        editorOpacity: record.editorOpacity ?? record.editor_opacity,
        controlPoints: record.controlPoints ?? record.control_points,
    };
};

const serializeHistoricOverlayDraftForSync = (draft) => JSON.stringify({
    id: normalizeHistoricOverlayDraftId(draft?.id),
    status: draft?.status === HISTORIC_OVERLAY_STATUS_READY
        ? HISTORIC_OVERLAY_STATUS_READY
        : HISTORIC_OVERLAY_STATUS_DRAFT,
    isPublic: Boolean(draft?.isPublic),
    publishedAt: typeof draft?.publishedAt === "string" ? draft.publishedAt : "",
    bounds: normalizeHistoricOverlayBounds(draft?.bounds),
    corners: normalizeHistoricOverlayCorners(draft?.corners, draft?.bounds),
    editorOpacity: Number.isFinite(Number(draft?.editorOpacity))
        ? Math.min(Math.max(Number(draft.editorOpacity), 0.1), 1)
        : DEFAULT_HISTORIC_DRAFT_EDITOR_OPACITY,
    sourceUrl: typeof draft?.sourceUrl === "string" ? draft.sourceUrl.trim() : "",
    attribution: typeof draft?.attribution === "string" ? draft.attribution.trim() : "",
    controlPoints: normalizeHistoricOverlayControlPoints(draft?.controlPoints),
});

const isHistoricOverlayDraftPersistable = (draft) => {
    if (!draft) return false;

    const normalizedCorners = normalizeHistoricOverlayCorners(draft.corners, draft.bounds);
    const normalizedBounds = deriveHistoricBoundsFromCorners(normalizedCorners)
        || normalizeHistoricOverlayBounds(draft.bounds);

    return Boolean(
        normalizedCorners
        || normalizedBounds
        || normalizeHistoricOverlayControlPoints(draft.controlPoints).length
        || (typeof draft.sourceUrl === "string" && draft.sourceUrl.trim())
        || (typeof draft.attribution === "string" && draft.attribution.trim())
        || draft.status === HISTORIC_OVERLAY_STATUS_READY
        || draft.isPublic,
    );
};

const buildHistoricOverlayDraftSnapshotMap = (drafts) => new Map(
    (Array.isArray(drafts) ? drafts : []).map((draft) => [
        normalizeHistoricOverlayDraftId(draft?.id),
        serializeHistoricOverlayDraftForSync(draft),
    ]),
);

const buildHistoricOverlayUpsertPayload = (draft) => {
    const normalizedDraft = normalizeHistoricOverlayDraft(
        draft,
        HISTORIC_OVERLAY_DRAFT_TEMPLATES.find((template) => template.id === draft?.id),
    );

    return {
        overlay_id: normalizedDraft.id,
        status: normalizedDraft.status,
        is_public: Boolean(normalizedDraft.isPublic),
        bounds: normalizedDraft.bounds,
        corners: normalizedDraft.corners,
        control_points: normalizedDraft.controlPoints,
        editor_opacity: normalizedDraft.editorOpacity,
        source_url: normalizedDraft.sourceUrl || "",
        attribution: normalizedDraft.attribution || "",
        published_at: normalizedDraft.isPublic
            ? (normalizedDraft.publishedAt || new Date().toISOString())
            : null,
    };
};

const getHistoricOverlayCornerCenter = (corners) => {
    if (!corners) return null;

    const entries = [corners.nw, corners.ne, corners.se, corners.sw]
        .map((corner) => normalizeHistoricOverlayCorner(corner))
        .filter(Boolean);
    if (entries.length !== 4) return null;

    const avgLat = entries.reduce((sum, [latitude]) => sum + latitude, 0) / entries.length;
    const avgLng = entries.reduce((sum, [, longitude]) => sum + longitude, 0) / entries.length;
    return [avgLat, avgLng];
};

const offsetHistoricOverlayCorners = (corners, latitudeDelta, longitudeDelta) => {
    if (!corners) return corners;

    const nextCorners = {};
    for (const key of ["nw", "ne", "se", "sw"]) {
        const corner = normalizeHistoricOverlayCorner(corners[key]);
        if (!corner) return corners;
        nextCorners[key] = [corner[0] + latitudeDelta, corner[1] + longitudeDelta];
    }

    return nextCorners;
};

const createHistoricOverlayHandleIcon = (label, fillColor) =>
    L.divIcon({
        className: "historic-overlay-handle-icon",
        html: `<div style="width:22px;height:22px;border-radius:999px;border:2px solid #ffffff;background:${fillColor};box-shadow:0 4px 12px rgba(15,23,42,0.35);display:flex;align-items:center;justify-content:center;color:#ffffff;font-size:10px;font-weight:800;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${label}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
    });

const HISTORIC_OVERLAY_HANDLE_ICONS = {
    nw: createHistoricOverlayHandleIcon("NW", "#1d4ed8"),
    ne: createHistoricOverlayHandleIcon("NE", "#1d4ed8"),
    se: createHistoricOverlayHandleIcon("SE", "#1d4ed8"),
    sw: createHistoricOverlayHandleIcon("SW", "#1d4ed8"),
    center: createHistoricOverlayHandleIcon("+", "#0f766e"),
};

const solveLinearSystem = (matrix, vector) => {
    const size = matrix.length;
    const augmented = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

    for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
        let maxRow = pivotIndex;
        for (let rowIndex = pivotIndex + 1; rowIndex < size; rowIndex += 1) {
            if (Math.abs(augmented[rowIndex][pivotIndex]) > Math.abs(augmented[maxRow][pivotIndex])) {
                maxRow = rowIndex;
            }
        }

        if (Math.abs(augmented[maxRow][pivotIndex]) < 1e-9) {
            return null;
        }

        if (maxRow !== pivotIndex) {
            [augmented[pivotIndex], augmented[maxRow]] = [augmented[maxRow], augmented[pivotIndex]];
        }

        const pivot = augmented[pivotIndex][pivotIndex];
        for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
            augmented[pivotIndex][columnIndex] /= pivot;
        }

        for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
            if (rowIndex === pivotIndex) continue;
            const factor = augmented[rowIndex][pivotIndex];
            for (let columnIndex = pivotIndex; columnIndex <= size; columnIndex += 1) {
                augmented[rowIndex][columnIndex] -= factor * augmented[pivotIndex][columnIndex];
            }
        }
    }

    return augmented.map((row) => row[size]);
};

const computeProjectiveMatrix3d = (sourceWidth, sourceHeight, destinationPoints) => {
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight)) return "";
    if (sourceWidth <= 0 || sourceHeight <= 0) return "";
    if (!Array.isArray(destinationPoints) || destinationPoints.length !== 4) return "";

    const sourcePoints = [
        [0, 0],
        [sourceWidth, 0],
        [sourceWidth, sourceHeight],
        [0, sourceHeight],
    ];

    const matrix = [];
    const vector = [];

    sourcePoints.forEach(([sourceX, sourceY], index) => {
        const point = destinationPoints[index];
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
            matrix.length = 0;
            vector.length = 0;
            return;
        }

        matrix.push([sourceX, sourceY, 1, 0, 0, 0, -sourceX * point.x, -sourceY * point.x]);
        vector.push(point.x);
        matrix.push([0, 0, 0, sourceX, sourceY, 1, -sourceX * point.y, -sourceY * point.y]);
        vector.push(point.y);
    });

    if (matrix.length !== 8 || vector.length !== 8) return "";

    const solution = solveLinearSystem(matrix, vector);
    if (!solution) return "";

    const [h11, h12, h13, h21, h22, h23, h31, h32] = solution;
    const coefficients = [
        h11, h21, 0, h31,
        h12, h22, 0, h32,
        0, 0, 1, 0,
        h13, h23, 0, 1,
    ];

    return `matrix3d(${coefficients.map((value) => Number(value.toFixed(12))).join(",")})`;
};

const buildHistoricOverlayDrafts = (storedDrafts, remoteDrafts = []) => {
    const buildDraftMap = (drafts) => new Map(
        (Array.isArray(drafts) ? drafts : [])
            .map(normalizeHistoricOverlaySourceRecord)
            .filter(Boolean)
            .map((draft) => [draft.id, draft]),
    );

    const storedDraftMap = buildDraftMap(storedDrafts);
    const remoteDraftMap = buildDraftMap(remoteDrafts);

    return HISTORIC_OVERLAY_DRAFT_TEMPLATES.map((template) =>
        normalizeHistoricOverlayDraft(
            {
                ...(storedDraftMap.get(template.id) || {}),
                ...(remoteDraftMap.get(template.id) || {}),
            },
            template,
        ),
    );
};

const readHistoricOverlayEditorModeFromQuery = () => {
    if (typeof window === "undefined") return false;

    const value = new URLSearchParams(window.location.search).get("historic_editor");
    if (!value) return false;

    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
};

const getWaybackReleaseDate = (release) => {
    const rawLabel = [release?.releaseName, release?.itemTitle, release?.snapshotLabel]
        .filter(Boolean)
        .join(" ");
    const match = rawLabel.match(/\d{4}-\d{2}-\d{2}/);
    if (!match) return null;

    const parsed = new Date(`${match[0]}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatWaybackOptionLabel = (release) => {
    const parsedDate = getWaybackReleaseDate(release);
    if (!parsedDate) return release?.releaseName || release?.itemTitle || "Undated snapshot";

    return parsedDate.toLocaleDateString("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
    });
};

const buildWaybackReleaseGroups = (releases) => {
    const groups = new Map();

    releases.forEach((release) => {
        const parsedDate = getWaybackReleaseDate(release);
        const groupLabel = parsedDate ? String(parsedDate.getUTCFullYear()) : "Undated";
        if (!groups.has(groupLabel)) {
            groups.set(groupLabel, []);
        }

        groups.get(groupLabel).push(release);
    });

    return Array.from(groups.entries()).map(([label, options]) => ({
        label,
        options,
    }));
};

const TYPE_LABELS = {
    bike: "Bike",
    historic: "Historic find",
    motorbike: "Motorbike",
    trolley: "Trolley",
    misc: "Misc",
};

const TYPE_PLURAL_LABELS = {
    bike: "bikes",
    historic: "historic finds",
    motorbike: "motorbikes",
    trolley: "trolleys",
    misc: "misc items",
};

const ASSUMED_ITEM_WEIGHTS_KG = {
    trolley: 28,
    bike: 15,
    historic: 1,
    motorbike: 180,
    misc: 30,
};
const CONSERVATIVE_SCRAP_VALUE_GBP_PER_KG = {
    min: 0.08,
    max: 0.15,
};

const formatGbp = (value) => `£${value.toFixed(2)}`;

// Returns a resized Supabase Storage image URL for thumbnails. Falls back to the
// original URL unchanged for any non-Supabase or already-transformed URL.
const getStorageThumbnailUrl = (url, width = 400, quality = 75) => {
    if (!url) return url;
    try {
        const u = new URL(url);
        if (!u.pathname.includes("/storage/v1/object/public/")) return url;
        u.pathname = u.pathname.replace(
            "/storage/v1/object/public/",
            "/storage/v1/render/image/public/",
        );
        u.searchParams.set("width", String(width));
        u.searchParams.set("quality", String(quality));
        return u.toString();
    } catch {
        return url;
    }
};

const ITEMS_STORAGE_KEY = "cleanup-items-v1";
const ITEMS_FETCH_TS_KEY = "cleanup-items-v1_ts";
const COUNT_STORAGE_KEY = "cleanup-item-counts-v1";
const GPS_STORAGE_KEY = "cleanup-item-gps-v1";
const WEIGHT_STORAGE_KEY = "cleanup-item-weights-v1";
const GEOLOOKUP_STORAGE_KEY = "cleanup-item-geolookup-v1";
const ITEM_STORY_STORAGE_KEY = "cleanup-item-story-v1";
const CONTRIBUTORS_STORAGE_KEY = "cleanup-contributors-v1";
const CONTRIBUTORS_FETCH_TS_KEY = "cleanup-contributors-v1_ts";
const POIS_STORAGE_KEY = "cleanup-pois-v1";
const POIS_FETCH_TS_KEY = "cleanup-pois-v1_ts";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — reduces Supabase egress on repeat page loads
const LANCASTER_TIDE_JSON_URL = `${import.meta.env.BASE_URL}lancaster-tides.json`;
const LANCASTER_TIDE_CHART_URL =
    "https://www.tide-forecast.com/tide/Lancaster/tide-times";
const TIDE_CHART_MIN_WIDTH = 640;
const TIDE_CHART_PIXELS_PER_POINT = 120;
const CLEANUP_WINDOW_MINUTES = 120;
const EA_STATIONS_URL =
    "https://environment.data.gov.uk/flood-monitoring/id/stations?riverName=River%20Lune";
const EA_REGIONAL_FLOW_STATIONS_URL =
    `https://environment.data.gov.uk/flood-monitoring/id/stations?parameter=flow&lat=${RIVER_LUNE_CENTER[0]}&long=${RIVER_LUNE_CENTER[1]}&dist=100`;
const EA_TARGET_RIVER_NAME = "River Lune";
const EA_TARGET_LUNE_STATION_REFERENCES = new Set([
    "724839", // Glasson Dock
    "724735", // Lancaster Quay
    "724647", // Skerton Weir
    "724629", // Caton
    "722421", // Killington
    "722242", // Lunes Bridge
]);
const EA_TARGET_LUNE_STATION_LABELS = new Set([
    "glasson dock",
    "lancaster quay",
    "skerton weir",
    "caton",
    "killington",
    "lunes bridge",
]);
const EA_READINGS_REFRESH_MS = 15 * 60 * 1000;
const EA_FLOODS_URL = `https://environment.data.gov.uk/flood-monitoring/id/floods?lat=${RIVER_LUNE_CENTER[0]}&long=${RIVER_LUNE_CENTER[1]}&dist=15`;
const CLEANUP_FORECAST_URL = `https://api.open-meteo.com/v1/forecast?latitude=${RIVER_LUNE_CENTER[0]}&longitude=${RIVER_LUNE_CENTER[1]}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&forecast_days=3&timezone=auto`;
const CLEANUP_FORECAST_REFRESH_MS = 30 * 60 * 1000;
const CLEANUP_FORECAST_RETRY_DELAYS_MS = [1500, 4000];
const RAINVIEWER_MAPS_URL = "https://api.rainviewer.com/public/weather-maps.json";
const RAINVIEWER_REFRESH_MS = 10 * 60 * 1000;
const RAINVIEWER_MIN_SUPPORTED_ZOOM = 0;
const RAINVIEWER_MAX_SUPPORTED_ZOOM = 7;
const OWNER_GITHUB_LOGINS = (import.meta.env.VITE_OWNER_GITHUB_LOGINS || "mrdiamonddirt")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
const OWNER_EMAILS = (import.meta.env.VITE_OWNER_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
const OWNER_SUPABASE_IDS = (import.meta.env.VITE_OWNER_SUPABASE_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
const FACEBOOK_PAGE_RECIPIENT_ID = (import.meta.env.VITE_FACEBOOK_PAGE_RECIPIENT_ID || "").trim();
const COMMUNITY_EMAIL_ACCOUNT = (import.meta.env.VITE_COMMUNITY_EMAIL_ACCOUNT || "").trim();
const ENABLE_PUBLIC_REPORTS = String(import.meta.env.VITE_ENABLE_PUBLIC_REPORTS ?? "true")
    .trim()
    .toLowerCase() !== "false";
const REPORT_NOTE_MAX_LENGTH = 280;
const REPORT_ACTION_COOLDOWN_MS = 12_000;
const REPORT_CONSENT_STORAGE_KEY = "cleanup-report-consent-v1";
const HISTORICAL_POI_STATUS_DRAFT = "draft";
const HISTORICAL_POI_STATUS_PUBLISHED = "published";

const LazyTidePlanner = lazy(() => import("./components/panels/TidePlanner"));
const LazyFloodStatusPanel = lazy(() => import("./components/panels/FloodStatusPanel"));
const LazySelectedItemDrawer = lazy(() => import("./components/panels/SelectedItemDrawer"));
const LazyFullscreenImageViewer = lazy(() => import("./components/panels/FullscreenImageViewer"));

const UI_TOKENS = {
    radius: {
        sm: "10px",
        md: "14px",
        lg: "18px",
        pill: "999px",
    },
    shadow: {
        soft: "0 8px 24px rgba(15,23,42,0.08)",
        raised: "0 14px 34px rgba(15,23,42,0.14)",
    },
    spacing: {
        xs: "6px",
        sm: "10px",
        md: "14px",
    },
};

const createMapsUrl = (lat, lng) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;

const hasValidCoordinatePair = (lat, lng) =>
    Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));

const resolveContributorMapsUrl = (contributor) => {
    const directUrl = String(
        contributor?.google_maps_link || contributor?.googleMapsLink || "",
    ).trim();
    if (directUrl) return directUrl;

    const lat = Number(contributor?.lat);
    const lng = Number(contributor?.lng);
    if (!hasValidCoordinatePair(lat, lng)) return "";

    return createMapsUrl(lat, lng);
};

const extractEaMeasureId = (value) => {
    if (typeof value !== "string") return null;

    const parts = value.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
};

const getEaStationKey = (station) =>
    station?.stationReference || station?.notation || station?.["@id"] || "";

const normalizeEaStationLabel = (value) =>
    String(value || "")
        .trim()
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/\s+/g, " ");

const isTrackedLuneStation = (station) => {
    const stationReference = String(station?.stationReference || station?.notation || "").trim();
    if (stationReference && EA_TARGET_LUNE_STATION_REFERENCES.has(stationReference)) return true;

    return EA_TARGET_LUNE_STATION_LABELS.has(normalizeEaStationLabel(station?.label));
};

const getEaMeasures = (station) =>
    Array.isArray(station?.measures) ? station.measures.filter(Boolean) : [];

const getEaMeasureByParameter = (station, parameter) => {
    const target = String(parameter || "").trim().toLowerCase();
    if (!target) return null;

    const measures = getEaMeasures(station);
    return (
        measures.find((measure) => String(measure?.parameter || "").trim().toLowerCase() === target)
        || null
    );
};

const getEaPrimaryMeasure = (station, preferredParameter = "level") => {
    const preferred = getEaMeasureByParameter(station, preferredParameter);
    if (preferred) return preferred;

    const measures = getEaMeasures(station);
    return measures.find((measure) => typeof measure?.["@id"] === "string") || null;
};

const getEaStationCoordinates = (station) => {
    const lat = Number(station?.lat);
    const lng = Number(station?.long);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

    return { lat, lng };
};

const hasEaMeasureId = (measure) => Boolean(extractEaMeasureId(measure?.["@id"]));

const isValidEaStationRecord = (
    station,
    {
        expectedRiverName = "",
        requireFlowMeasure = false,
        requirePrimaryMeasure = false,
        preferredParameter = "level",
    } = {},
) => {
    const stationKey = getEaStationKey(station);
    if (!stationKey) return false;

    const coordinates = getEaStationCoordinates(station);
    if (!coordinates) return false;

    if (expectedRiverName && station?.riverName !== expectedRiverName) return false;

    const measures = getEaMeasures(station);
    if (!measures.length) return false;

    if (requireFlowMeasure) {
        const flowMeasure = getEaMeasureByParameter(station, "flow");
        if (!hasEaMeasureId(flowMeasure)) return false;
    }

    if (requirePrimaryMeasure) {
        const primaryMeasure = getEaPrimaryMeasure(station, preferredParameter);
        if (!hasEaMeasureId(primaryMeasure)) return false;
    }

    return true;
};

const getUniqueEaStationsByKey = (stations) => {
    const byKey = new Map();

    stations.forEach((station) => {
        const stationKey = getEaStationKey(station);
        if (!stationKey || byKey.has(stationKey)) return;
        byKey.set(stationKey, station);
    });

    return [...byKey.values()];
};

const buildEaEmptyReading = ({ primaryMeasure = null, error = "No measure available" } = {}) => ({
    loading: false,
    error,
    value: null,
    unitName: primaryMeasure?.unitName || "",
    dateTime: "",
    parameterName: primaryMeasure?.parameterName || "",
    previousValue: null,
    previousUnitName: primaryMeasure?.unitName || "",
    previousDateTime: "",
    previousAgeLabel: "",
    deltaValue: null,
    deltaDirection: "flat",
    trendLabel: "Trend unavailable",
    trendDirection: "flat",
    trendDeltaValue: null,
    recentReadings: [],
    flowValue: null,
    flowUnitName: "",
    flowDateTime: "",
    flowTrendLabel: "",
    flowTrendDirection: "flat",
});

const parseEaMeasureReadings = (items) => {
    const normalizedItems = Array.isArray(items) ? items : [];
    const sortedReadings = [...normalizedItems].sort((a, b) => {
        const aTime = new Date(a?.dateTime || "").getTime();
        const bTime = new Date(b?.dateTime || "").getTime();

        if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
        if (!Number.isFinite(aTime)) return 1;
        if (!Number.isFinite(bTime)) return -1;

        return bTime - aTime;
    });

    const latest = sortedReadings[0] || null;
    const previous = sortedReadings[1] || null;
    const latestValue = Number(latest?.value);
    const previousValue = Number(previous?.value);
    const hasDelta = Number.isFinite(latestValue) && Number.isFinite(previousValue);
    const deltaValue = hasDelta ? latestValue - previousValue : null;
    const deltaDirection = getEaDeltaDirection(deltaValue);
    const recentReadings = sortedReadings
        .filter((item) => Number.isFinite(Number(item?.value)))
        .slice(0, 24)
        .map((item) => ({
            value: Number(item?.value),
            dateTime: item?.dateTime || "",
            ageLabel: formatEaRelativeAge(item?.dateTime || "") || "",
        }));
    const trend = inferEaTrendFromRecentReadings(recentReadings);

    return {
        latest,
        previous,
        deltaValue,
        deltaDirection,
        recentReadings,
        trend,
    };
};

const fetchEaMeasureSnapshot = async (measure) => {
    const measureId = extractEaMeasureId(measure?.["@id"]);
    if (!measureId) return { error: "No measure available", parsed: null };

    const response = await fetch(buildEaReadingsUrl(measureId), { cache: "no-store" });
    if (!response.ok) {
        throw new Error("Could not load reading");
    }

    const payload = await response.json();
    const parsed = parseEaMeasureReadings(payload?.items);

    return {
        error: parsed.latest ? "" : "No readings yet",
        parsed,
    };
};

const buildEaReadingsUrl = (measureId) => {
    const baseUrl = `https://environment.data.gov.uk/flood-monitoring/id/measures/${encodeURIComponent(measureId)}/readings`;

    return `${baseUrl}?_sorted&_limit=24`;
};

const formatEaReadingDateTime = (value) => {
    if (typeof value !== "string" || !value.trim()) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;

    return parsed.toLocaleString("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
    });
};

const formatEaRelativeAge = (value) => {
    if (typeof value !== "string" || !value.trim()) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;

    const deltaMs = Date.now() - parsed.getTime();
    if (!Number.isFinite(deltaMs)) return null;

    if (deltaMs < 60 * 1000) return "just now";

    const minutes = Math.round(deltaMs / (60 * 1000));
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.round(hours / 24);
    return `${days}d ago`;
};

const CLEANUP_WEATHER_CODE_LABELS = {
    0: "Clear",
    1: "Mostly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Freezing fog",
    51: "Light drizzle",
    53: "Drizzle",
    55: "Dense drizzle",
    56: "Freezing drizzle",
    57: "Heavy freezing drizzle",
    61: "Light rain",
    63: "Rain",
    65: "Heavy rain",
    66: "Freezing rain",
    67: "Heavy freezing rain",
    71: "Light snow",
    73: "Snow",
    75: "Heavy snow",
    77: "Snow grains",
    80: "Rain showers",
    81: "Heavy showers",
    82: "Violent showers",
    85: "Snow showers",
    86: "Heavy snow showers",
    95: "Thunderstorm",
    96: "Thunderstorm and hail",
    99: "Severe thunderstorm",
};

const formatCleanupWeatherCode = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return "Conditions unavailable";
    return CLEANUP_WEATHER_CODE_LABELS[numericValue] || "Mixed conditions";
};

const formatCleanupForecastHour = (value) => {
    if (typeof value !== "string" || !value.trim()) return "";

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";

    return parsed.toLocaleTimeString("en-GB", {
        hour: "numeric",
        minute: "2-digit",
    });
};

const formatCleanupForecastDay = (value) => {
    if (typeof value !== "string" || !value.trim()) return "";

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";

    return parsed.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
    });
};

const formatCleanupForecastTemperature = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return "--";
    return `${Math.round(numericValue)}°C`;
};

const formatCleanupForecastWind = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return "--";
    return `${Math.round(numericValue)} km/h`;
};

const formatCleanupForecastRainChance = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return "--";
    return `${Math.round(numericValue)}%`;
};

const buildCleanupForecast = (payload) => {
    const hourly = payload?.hourly || {};
    const daily = payload?.daily || {};
    const nowMs = Date.now();

    const hourlyRows = Array.isArray(hourly?.time)
        ? hourly.time.map((timeValue, index) => {
            const parsedTime = new Date(timeValue).getTime();
            return {
                time: timeValue,
                timeMs: parsedTime,
                label: formatCleanupForecastHour(timeValue),
                temperature: hourly?.temperature_2m?.[index] ?? null,
                rainChance: hourly?.precipitation_probability?.[index] ?? null,
                windSpeed: hourly?.wind_speed_10m?.[index] ?? null,
                weatherCode: hourly?.weather_code?.[index] ?? null,
                summary: formatCleanupWeatherCode(hourly?.weather_code?.[index]),
            };
        }).filter((row) => Number.isFinite(row.timeMs))
        : [];
    const upcomingHours = hourlyRows.filter((row) => row.timeMs >= nowMs).slice(0, 6);

    const dailyRows = Array.isArray(daily?.time)
        ? daily.time.map((timeValue, index) => ({
            date: timeValue,
            label: formatCleanupForecastDay(timeValue),
            summary: formatCleanupWeatherCode(daily?.weather_code?.[index]),
            minTemperature: daily?.temperature_2m_min?.[index] ?? null,
            maxTemperature: daily?.temperature_2m_max?.[index] ?? null,
            rainChance: daily?.precipitation_probability_max?.[index] ?? null,
            windSpeed: daily?.wind_speed_10m_max?.[index] ?? null,
        }))
        : [];

    if (!hourlyRows.length && !dailyRows.length) {
        throw new Error("Forecast payload did not contain any hourly or daily rows.");
    }

    const nextHour = upcomingHours[0] || null;
    const rainiestHour = [...upcomingHours]
        .sort((left, right) => Number(right?.rainChance || -1) - Number(left?.rainChance || -1))[0] || null;
    const windiestHour = [...upcomingHours]
        .sort((left, right) => Number(right?.windSpeed || -1) - Number(left?.windSpeed || -1))[0] || null;

    return {
        headline: nextHour
            ? `${nextHour.summary} around ${nextHour.label}`
            : "Forecast unavailable",
        nextHour: nextHour
            ? {
                ...nextHour,
                temperatureLabel: formatCleanupForecastTemperature(nextHour.temperature),
                rainChanceLabel: formatCleanupForecastRainChance(nextHour.rainChance),
                windSpeedLabel: formatCleanupForecastWind(nextHour.windSpeed),
            }
            : null,
        highlights: [
            rainiestHour
                ? {
                    label: "Rain risk",
                    value: `${formatCleanupForecastRainChance(rainiestHour.rainChance)} at ${rainiestHour.label}`,
                }
                : null,
            windiestHour
                ? {
                    label: "Wind",
                    value: `${formatCleanupForecastWind(windiestHour.windSpeed)} at ${windiestHour.label}`,
                }
                : null,
        ].filter(Boolean),
        upcomingHours: upcomingHours.map((hour) => ({
            ...hour,
            temperatureLabel: formatCleanupForecastTemperature(hour.temperature),
            rainChanceLabel: formatCleanupForecastRainChance(hour.rainChance),
            windSpeedLabel: formatCleanupForecastWind(hour.windSpeed),
        })),
        daily: dailyRows.map((day) => ({
            ...day,
            minTemperatureLabel: formatCleanupForecastTemperature(day.minTemperature),
            maxTemperatureLabel: formatCleanupForecastTemperature(day.maxTemperature),
            rainChanceLabel: formatCleanupForecastRainChance(day.rainChance),
            windSpeedLabel: formatCleanupForecastWind(day.windSpeed),
        })),
    };
};

const formatEaElapsedSpan = (deltaMs) => {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return null;

    const totalMinutes = Math.round(deltaMs / (60 * 1000));
    if (totalMinutes < 60) return `${totalMinutes}m`;

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;

    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
};

const getEaDeltaDirection = (deltaValue) => {
    if (!Number.isFinite(deltaValue) || Math.abs(deltaValue) < 0.0005) return "flat";
    return deltaValue > 0 ? "up" : "down";
};

const inferEaTrendFromRecentReadings = (recentReadings) => {
    if (!Array.isArray(recentReadings) || recentReadings.length < 2) {
        return {
            direction: "flat",
            label: "Trend unavailable",
            deltaValue: null,
        };
    }

    const newest = Number(recentReadings[0]?.value);
    const oldest = Number(recentReadings[recentReadings.length - 1]?.value);
    if (!Number.isFinite(newest) || !Number.isFinite(oldest)) {
        return {
            direction: "flat",
            label: "Trend unavailable",
            deltaValue: null,
        };
    }

    const chronological = [...recentReadings].reverse();
    const stepDirections = [];
    for (let index = 1; index < chronological.length; index += 1) {
        const previousValue = Number(chronological[index - 1]?.value);
        const currentValue = Number(chronological[index]?.value);
        if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue)) continue;
        stepDirections.push(getEaDeltaDirection(currentValue - previousValue));
    }

    const nonFlatSteps = stepDirections.filter((step) => step !== "flat");
    const totalDelta = newest - oldest;
    const direction = getEaDeltaDirection(totalDelta);
    const allUp = nonFlatSteps.length > 0 && nonFlatSteps.every((step) => step === "up");
    const allDown = nonFlatSteps.length > 0 && nonFlatSteps.every((step) => step === "down");

    if (direction === "flat") {
        return {
            direction,
            label: "Stable",
            deltaValue: totalDelta,
        };
    }

    if (allUp) {
        return {
            direction,
            label: "Rising",
            deltaValue: totalDelta,
        };
    }

    if (allDown) {
        return {
            direction,
            label: "Falling",
            deltaValue: totalDelta,
        };
    }

    return {
        direction,
        label: direction === "up" ? "Choppy rise" : "Choppy fall",
        deltaValue: totalDelta,
    };
};

const parseGpsNumber = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
};

const parseEstimatedWeightKg = (value) => {
    if (value === "" || value === null || value === undefined) return null;

    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;

    return Math.round(parsed * 10) / 10;
};

const normalizeOptionalDateInput = (value) => {
    if (typeof value !== "string") return "";

    const trimmed = value.trim();
    if (!trimmed) return "";

    const simpleDateMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (simpleDateMatch) {
        return `${simpleDateMatch[1]}-${simpleDateMatch[2]}-${simpleDateMatch[3]}`;
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return "";

    return parsed.toISOString().slice(0, 10);
};

const parseDateInputToUtcDate = (value) => {
    const normalized = normalizeOptionalDateInput(value);
    if (!normalized) return null;

    const parsed = new Date(`${normalized}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return null;

    return parsed;
};

const formatStoryDate = (value) => {
    const parsed = parseDateInputToUtcDate(value);
    if (!parsed) return "";

    return parsed.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
};

const formatTimeInRiver = (knownSinceDate, recoveredOnDate) => {
    const start = parseDateInputToUtcDate(knownSinceDate);
    const end = parseDateInputToUtcDate(recoveredOnDate);
    if (!start || !end || end < start) return "";

    let totalMonths =
        (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
        (end.getUTCMonth() - start.getUTCMonth());

    if (end.getUTCDate() < start.getUTCDate()) {
        totalMonths -= 1;
    }

    if (totalMonths < 0) totalMonths = 0;

    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;

    if (years > 0 && months > 0) return `${years}y ${months}m`;
    if (years > 0) return `${years} year${years === 1 ? "" : "s"}`;
    if (months > 0) return `${months} month${months === 1 ? "" : "s"}`;

    return "Less than a month";
};

const isItemStoryEmpty = (story) => {
    if (!story || typeof story !== "object") return true;

    return !(
        normalizeOptionalDateInput(story.knownSinceDate) ||
        normalizeOptionalDateInput(story.recoveredOnDate) ||
        (typeof story.referenceImageUrl === "string" && story.referenceImageUrl.trim()) ||
        (typeof story.referenceImageCaption === "string" && story.referenceImageCaption.trim())
    );
};

const buildShareItemUrl = (itemId) => {
    if (typeof window === "undefined") return "";

    const normalizedId = String(itemId || "").trim();
    if (!normalizedId) return "";

    const pathname = window.location.pathname || "/";
    const shareSegmentIndex = pathname.indexOf("/share/");
    const basePathRaw = shareSegmentIndex >= 0 ? pathname.slice(0, shareSegmentIndex) : pathname;
    const basePath = basePathRaw.replace(/\/+$/, "");
    const prefix = basePath && basePath !== "/" ? basePath : "";

    return `${window.location.origin}${prefix}/share/${encodeURIComponent(normalizedId)}/`;
};

const buildMessengerThreadUrl = (recipientId) => {
    const normalizedId = String(recipientId || "").trim();
    if (!normalizedId) return "";

    return `https://www.messenger.com/t/${encodeURIComponent(normalizedId)}`;
};

const preserveReportNoteInput = (value) =>
    String(value || "")
        .slice(0, REPORT_NOTE_MAX_LENGTH);

const sanitizeReportNote = (value) =>
    String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, REPORT_NOTE_MAX_LENGTH);

const buildPublicReportMessage = ({ latitude, longitude, note, reporterLabel, sourceUrl, w3wAddress }) => {
    const latText = formatCoordinate(latitude, 6) || String(latitude);
    const lngText = formatCoordinate(longitude, 6) || String(longitude);
    const mapsUrl = createMapsUrl(latitude, longitude);
    const timestamp = new Date().toISOString();
    const cleanedNote = sanitizeReportNote(note);
    const lines = [
        "Hi River Lune Cleanup team,",
        "",
        "I am sending a report from the cleanup map.",
        `GPS: ${latText}, ${lngText}`,
    ];

    if (w3wAddress) {
        lines.push(`What3Words: ///${w3wAddress} (https://what3words.com/${w3wAddress})`);
    }

    lines.push(
        `Google Maps: ${mapsUrl}`,
        `Reporter: ${reporterLabel || "Anonymous website visitor"}`,
    );

    if (cleanedNote) {
        lines.push(`Details: ${cleanedNote}`);
    }

    if (sourceUrl) {
        lines.push(`Source page: ${sourceUrl}`);
    }

    lines.push(`Timestamp (UTC): ${timestamp}`);

    return lines.join("\n");
};

const readSelectedItemIdFromQuery = () => {
    if (typeof window === "undefined") return null;

    const selected = new URLSearchParams(window.location.search).get("item");
    if (selected) {
        const normalized = selected.trim();
        if (normalized) return normalized;
    }

    const pathSegments = window.location.pathname
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);

    let shareItemId = "";
    for (let i = 0; i < pathSegments.length - 1; i += 1) {
        if (pathSegments[i].toLowerCase() === "share") {
            shareItemId = pathSegments[i + 1] || shareItemId;
        }
    }

    if (!shareItemId) return null;

    try {
        const decoded = decodeURIComponent(shareItemId).trim();
        return decoded || null;
    } catch {
        return shareItemId.trim() || null;
    }
};

const normalizePoiSlug = (value) => String(value || "").trim().toLowerCase();

const readSelectedPoiSlugFromQuery = () => {
    if (typeof window === "undefined") return null;

    const searchParams = new URLSearchParams(window.location.search);
    const selectedItem = searchParams.get("item");
    if (selectedItem && selectedItem.trim()) {
        return null;
    }

    const selectedPoi = searchParams.get("poi");
    if (selectedPoi) {
        const normalized = normalizePoiSlug(selectedPoi);
        if (normalized) return normalized;
    }

    const pathSegments = window.location.pathname
        .split("/")
        .map((segment) => segment.trim())
        .filter(Boolean);

    let poiSlugFromPath = "";
    for (let i = 0; i < pathSegments.length - 1; i += 1) {
        if (pathSegments[i].toLowerCase() === "poi") {
            poiSlugFromPath = pathSegments[i + 1] || poiSlugFromPath;
        }
    }

    if (!poiSlugFromPath) return null;

    try {
        const decoded = normalizePoiSlug(decodeURIComponent(poiSlugFromPath));
        return decoded || null;
    } catch {
        const normalized = normalizePoiSlug(poiSlugFromPath);
        return normalized || null;
    }
};

const buildGpsLookupKey = (latitude, longitude) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";

    return `${latitude.toFixed(5)},${longitude.toFixed(5)}`;
};

const formatReverseGeocodeResult = (payload) => {
    const address = payload?.address || {};
    const road = address.road || address.pedestrian || address.footway || "";
    const area =
        address.suburb ||
        address.neighbourhood ||
        address.hamlet ||
        address.village ||
        "";
    const city = address.city || address.town || address.city_district || "Lancaster";
    const county = address.county || "Lancashire";
    const countryCode = (address.country_code || "gb").toUpperCase();
    const postcode = address.postcode || "";

    const parts = [road, area, city, county].filter(Boolean);

    return {
        label: parts.length ? parts.join(", ") : "Lancaster, Lancashire",
        postcode,
        countryCode,
        source: "nominatim",
    };
};

const buildFallbackGeoLookup = () => ({
    label: "Lancaster, Lancashire",
    postcode: "",
    countryCode: "GB",
    source: "fallback",
});

const shouldResolveGeoLookup = (geoLookup) => {
    if (!geoLookup) return true;
    if (geoLookup.source === "fallback") return true;

    const normalizedLabel = (geoLookup.label || "").trim().toLowerCase();
    if (!normalizedLabel) return true;

    return normalizedLabel === "lancaster, lancashire" && !geoLookup.postcode;
};

const fetchReverseGeocodeForGps = async (latitude, longitude) => {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");

    const response = await fetch(url.toString(), {
        headers: {
            Accept: "application/json",
        },
    });

    if (!response.ok) {
        throw new Error("Reverse geocode request failed");
    }

    const payload = await response.json();
    return formatReverseGeocodeResult(payload);
};

const formatWeightKg = (value) => {
    if (!Number.isFinite(value)) return "0 kg";
    return Number.isInteger(value) ? `${value} kg` : `${value.toFixed(1)} kg`;
};

const getDefaultWeightForType = (type) =>
    ASSUMED_ITEM_WEIGHTS_KG[normalizeType(type)] || ASSUMED_ITEM_WEIGHTS_KG.misc;

const readStoredJson = (storageKey, fallbackValue, isValid) => {
    if (typeof window === "undefined") return fallbackValue;

    try {
        const stored = window.localStorage.getItem(storageKey);
        if (!stored) return fallbackValue;

        const parsed = JSON.parse(stored);
        return isValid(parsed) ? parsed : fallbackValue;
    } catch {
        return fallbackValue;
    }
};

const isPlainObjectRecord = (value) => value && typeof value === "object" && !Array.isArray(value);

const deferUntilIdle = (callback, timeoutMs = 1200) => {
    if (typeof window === "undefined") {
        callback();
        return () => {};
    }

    if (typeof window.requestIdleCallback === "function") {
        const idleId = window.requestIdleCallback(() => {
            callback();
        }, { timeout: timeoutMs });

        return () => {
            window.cancelIdleCallback(idleId);
        };
    }

    const timerId = window.setTimeout(() => {
        callback();
    }, 0);

    return () => {
        window.clearTimeout(timerId);
    };
};

const storedItemsBootstrap = readStoredJson(ITEMS_STORAGE_KEY, [], Array.isArray);
const storedHistoricOverlayDrafts = readStoredJson(
    HISTORIC_OVERLAY_DRAFTS_STORAGE_KEY,
    [],
    Array.isArray,
);
const startupStoredState = {
    items: storedItemsBootstrap,
    counts: readStoredJson(COUNT_STORAGE_KEY, {}, isPlainObjectRecord),
    gps: readStoredJson(GPS_STORAGE_KEY, {}, isPlainObjectRecord),
    weights: readStoredJson(WEIGHT_STORAGE_KEY, {}, isPlainObjectRecord),
    geolookup: readStoredJson(GEOLOOKUP_STORAGE_KEY, {}, isPlainObjectRecord),
    itemStory: readStoredJson(ITEM_STORY_STORAGE_KEY, {}, isPlainObjectRecord),
    historicOverlayDrafts: buildHistoricOverlayDrafts(storedHistoricOverlayDrafts),
};

const inferDbCountFieldSupport = (items) => {
    const first = Array.isArray(items) ? items[0] : null;

    return {
        total: Boolean(first && Object.prototype.hasOwnProperty.call(first, "total_count")),
        recovered: Boolean(first && Object.prototype.hasOwnProperty.call(first, "recovered_count")),
    };
};

const inferDbGpsFieldSupport = (items) => {
    const first = Array.isArray(items) ? items[0] : null;

    return {
        latitude: first ? Object.prototype.hasOwnProperty.call(first, "gps_latitude") : null,
        longitude: first ? Object.prototype.hasOwnProperty.call(first, "gps_longitude") : null,
    };
};

const inferDbWeightFieldSupport = (items) => {
    const first = Array.isArray(items) ? items[0] : null;

    return first ? Object.prototype.hasOwnProperty.call(first, "estimated_weight_kg") : null;
};

const inferDbW3wFieldSupport = (items) => {
    const first = Array.isArray(items) ? items[0] : null;

    return first ? Object.prototype.hasOwnProperty.call(first, "w3w_address") : null;
};

const inferDbGeoFieldSupport = (items) => {
    const first = Array.isArray(items) ? items[0] : null;

    return {
        label: first ? Object.prototype.hasOwnProperty.call(first, "geocode_label") : null,
        postcode: first ? Object.prototype.hasOwnProperty.call(first, "geocode_postcode") : null,
        countryCode: first ? Object.prototype.hasOwnProperty.call(first, "geocode_country_code") : null,
        source: first ? Object.prototype.hasOwnProperty.call(first, "geocode_source") : null,
    };
};

const inferDbStoryFieldSupport = (items) => {
    const first = Array.isArray(items) ? items[0] : null;

    return {
        knownSinceDate: first ? Object.prototype.hasOwnProperty.call(first, "known_since_date") : null,
        recoveredOnDate: first ? Object.prototype.hasOwnProperty.call(first, "recovered_on_date") : null,
        referenceImageUrl: first ? Object.prototype.hasOwnProperty.call(first, "reference_image_url") : null,
        referenceImageCaption: first ? Object.prototype.hasOwnProperty.call(first, "reference_image_caption") : null,
    };
};

const buildLiveLocationSample = (position) => {
    const latitude = parseGpsNumber(position?.coords?.latitude);
    const longitude = parseGpsNumber(position?.coords?.longitude);

    if (latitude === null || longitude === null) return null;
    if (latitude < -90 || latitude > 90) return null;
    if (longitude < -180 || longitude > 180) return null;

    const accuracy = parseGpsNumber(position?.coords?.accuracy);

    return {
        latitude,
        longitude,
        accuracy,
        timestamp: position?.timestamp || Date.now(),
    };
};

const shouldReplaceLiveLocation = (currentSample, nextSample) => {
    if (!nextSample) return false;
    if (!currentSample) return true;

    if (nextSample.accuracy === null) {
        return currentSample.accuracy === null && nextSample.timestamp > currentSample.timestamp;
    }

    if (currentSample.accuracy === null) return true;

    if (nextSample.accuracy < currentSample.accuracy - 3) return true;

    return (
        nextSample.accuracy <= currentSample.accuracy + 2 &&
        nextSample.timestamp > currentSample.timestamp + 15000
    );
};

const getLiveLocationErrorMessage = (error) => {
    if (!error) return "Unable to fetch live location right now.";

    switch (error.code) {
        case error.PERMISSION_DENIED:
            return "Location access was denied.";
        case error.POSITION_UNAVAILABLE:
            return "Location data is unavailable right now.";
        case error.TIMEOUT:
            return "Timed out while waiting for a GPS fix.";
        default:
            return "Unable to fetch live location right now.";
    }
};

const getGitHubLoginFromUser = (user) => {
    if (!user) return "";

    const metadata = user.user_metadata || {};
    const candidates = [
        metadata.user_name,
        metadata.preferred_username,
        metadata.username,
        metadata.login,
    ];

    const firstMatch = candidates.find((value) => typeof value === "string" && value.trim());
    return firstMatch ? firstMatch.trim().toLowerCase() : "";
};

const canUserManageItems = (user) => {
    if (!user) return false;

    if (OWNER_SUPABASE_IDS.includes(user.id)) return true;

    const email = typeof user.email === "string" ? user.email.trim().toLowerCase() : "";
    if (email && OWNER_EMAILS.includes(email)) return true;

    const githubLogin = getGitHubLoginFromUser(user);
    if (githubLogin && OWNER_GITHUB_LOGINS.includes(githubLogin)) return true;

    return false;
};

const getSupabaseAuthErrorMessage = (error) => {
    const message = String(error?.message || "").trim();
    const normalizedMessage = message.toLowerCase();

    if (
        normalizedMessage.includes("issued in the future")
        || normalizedMessage.includes("clock skew")
        || normalizedMessage.includes("device clock")
    ) {
        return "Your sign-in session looks invalid because this device clock is out of sync. Correct the clock, then sign out and sign back in.";
    }

    return "Unable to verify sign-in state right now.";
};

const parseLancasterTideDate = (timeText, fallbackYear = new Date().getFullYear()) => {
    if (!timeText) return null;

    const match = timeText.match(
        /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*\((?:[A-Za-z]{3}\s+)?(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\)$/i,
    );

    if (!match) return null;

    let [, rawHours, rawMinutes, period, rawDay, rawMonth, rawYear] = match;
    let hours = Number.parseInt(rawHours, 10);
    const minutes = Number.parseInt(rawMinutes, 10);
    const day = Number.parseInt(rawDay, 10);
    const year = Number.parseInt(rawYear || String(fallbackYear), 10);
    const monthIndex = new Date(`${rawMonth} 1, ${year}`).getMonth();

    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || !Number.isInteger(day)) {
        return null;
    }

    if (Number.isNaN(monthIndex)) return null;

    if (hours === 12 && /^AM$/i.test(period)) hours = 0;
    else if (hours === 12 && /^PM$/i.test(period)) hours = 12;
    else if (hours === 0 && /^PM$/i.test(period)) hours = 12;
    else if (/^PM$/i.test(period)) hours += 12;

    return new Date(year, monthIndex, day, hours, minutes, 0, 0);
};

const parseTideHeightMeters = (heightText) => {
    if (!heightText) return null;

    const match = heightText.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;

    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
};

const formatTideTime = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
    }).format(date);
};

const formatTideDay = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
    }).format(date);
};

const formatTideClockTime = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date);
};

const buildCurrentTideMarker = (chartData, currentTime) => {
    const points = chartData?.points || [];
    if (points.length < 2) return null;

    const currentTimestamp = currentTime instanceof Date ? currentTime.getTime() : Number(currentTime);
    if (!Number.isFinite(currentTimestamp)) return null;

    const firstPoint = points[0];
    const lastPoint = points[points.length - 1];
    const firstTime = firstPoint.date.getTime();
    const lastTime = lastPoint.date.getTime();

    if (currentTimestamp < firstTime || currentTimestamp > lastTime) return null;

    for (let index = 0; index < points.length - 1; index += 1) {
        const start = points[index];
        const end = points[index + 1];
        const startTime = start.date.getTime();
        const endTime = end.date.getTime();

        if (currentTimestamp < startTime || currentTimestamp > endTime) continue;

        const segmentProgress = (currentTimestamp - startTime) / (endTime - startTime || 1);
        const easedProgress = (1 - Math.cos(Math.PI * segmentProgress)) / 2;
        const currentHeight = start.height + (end.height - start.height) * easedProgress;

        return {
            time: new Date(currentTimestamp),
            height: currentHeight,
            x: start.x + (end.x - start.x) * segmentProgress,
            y: start.y + (end.y - start.y) * easedProgress,
            previous: start,
            next: end,
        };
    }

    return null;
};

const buildTideChartData = (rows, updatedAt) => {
    if (!Array.isArray(rows) || rows.length < 2) return null;

    const fallbackYear = updatedAt ? new Date(updatedAt).getFullYear() : new Date().getFullYear();
    const parsedRows = rows
        .map((row, index) => {
            const date = parseLancasterTideDate(row.time, fallbackYear);
            const height = parseTideHeightMeters(row.height);

            if (!date || height === null) return null;

            return {
                ...row,
                index,
                date,
                height,
                isLowTide: /low tide/i.test(row.type),
            };
        })
        .filter(Boolean)
        .sort((left, right) => left.date - right.date);

    if (parsedRows.length < 2) return null;

    const width = Math.max(TIDE_CHART_MIN_WIDTH, parsedRows.length * TIDE_CHART_PIXELS_PER_POINT);
    const height = 196;
    const padding = { top: 8, right: 12, bottom: 16, left: 12 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const times = parsedRows.map((row) => row.date.getTime());
    const heights = parsedRows.map((row) => row.height);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const minHeight = Math.min(...heights);
    const maxHeight = Math.max(...heights);
    const medianHeight = (minHeight + maxHeight) / 2;
    const heightRange = Math.max(maxHeight - minHeight, 1);
    const verticalPadding = Math.max(heightRange * 0.12, 0.4);
    const chartMinHeight = minHeight - verticalPadding;
    const chartMaxHeight = maxHeight + verticalPadding;
    const visibleHeightRange = chartMaxHeight - chartMinHeight;

    const getX = (time) => {
        if (maxTime === minTime) return padding.left + chartWidth / 2;
        const ratio = (time - minTime) / (maxTime - minTime);
        return padding.left + ratio * chartWidth;
    };

    const getY = (value) => {
        if (visibleHeightRange === 0) return padding.top + chartHeight / 2;
        const ratio = (value - chartMinHeight) / visibleHeightRange;
        return padding.top + chartHeight - ratio * chartHeight;
    };

    const points = parsedRows.map((row) => ({
        ...row,
        x: getX(row.date.getTime()),
        y: getY(row.height),
    }));

    const curvePath = points.reduce((path, point, index) => {
        if (index === 0) {
            return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
        }

        const previousPoint = points[index - 1];
        const controlX = previousPoint.x + (point.x - previousPoint.x) / 2;

        return `${path} C ${controlX.toFixed(2)} ${previousPoint.y.toFixed(2)}, ${controlX.toFixed(2)} ${point.y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }, "");

    const areaPath = `${curvePath} L ${points[points.length - 1].x.toFixed(2)} ${(padding.top + chartHeight).toFixed(2)} L ${points[0].x.toFixed(2)} ${(padding.top + chartHeight).toFixed(2)} Z`;

    const cleanupWindows = parsedRows
        .filter((row) => row.isLowTide)
        .map((row) => {
            const centerTime = row.date.getTime();
            const startTime = Math.max(minTime, centerTime - CLEANUP_WINDOW_MINUTES * 60 * 1000);
            const endTime = Math.min(maxTime, centerTime + CLEANUP_WINDOW_MINUTES * 60 * 1000);

            return {
                index: row.index,
                startTime,
                endTime,
                xStart: getX(startTime),
                xEnd: getX(endTime),
                lowTideX: getX(centerTime),
            };
        });

    return {
        width,
        height,
        padding,
        minTime,
        maxTime,
        baselineY: padding.top + chartHeight,
        medianY: getY(medianHeight),
        points,
        curvePath,
        areaPath,
        cleanupWindows,
    };
};

const SANITIZED_IMAGE_QUALITY = 0.92;

const IMAGE_MIME_TO_EXTENSION = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
};

const isSupportedSanitizedMimeType = (mimeType) =>
    mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp";

const getSanitizedImageMimeType = (mimeType) => {
    if (isSupportedSanitizedMimeType(mimeType)) return mimeType;
    return "image/jpeg";
};

const getImageExtensionFromMimeType = (mimeType) => IMAGE_MIME_TO_EXTENSION[mimeType] || "jpg";

const buildFileNameWithExtension = (originalName, extension) => {
    const baseName = (originalName || "image")
        .replace(/\.[^.]*$/, "")
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^a-zA-Z0-9-_]/g, "");

    return `${baseName || "image"}.${extension}`;
};

const blobToDataUrl = (blob) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read image data."));
        reader.readAsDataURL(blob);
    });

const loadImageFromDataUrl = (dataUrl) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not decode selected image."));
        image.src = dataUrl;
    });

const canvasToBlob = (canvas, mimeType, quality) =>
    new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                    return;
                }
                reject(new Error("Could not prepare sanitized image."));
            },
            mimeType,
            quality,
        );
    });

const sanitizeImageFile = async (file) => {
    if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) {
        return file;
    }

    const outputMimeType = getSanitizedImageMimeType(file.type);
    const quality = outputMimeType === "image/png" ? undefined : SANITIZED_IMAGE_QUALITY;
    let canvas = null;

    try {
        if (typeof OffscreenCanvas === "function" && typeof createImageBitmap === "function") {
            let bitmap;
            try {
                bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
            } catch {
                bitmap = await createImageBitmap(file);
            }
            canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
            const context = canvas.getContext("2d");

            if (!context) {
                bitmap.close?.();
                throw new Error("Could not get image context.");
            }

            context.drawImage(bitmap, 0, 0);
            bitmap.close?.();
            const blob = await canvas.convertToBlob({ type: outputMimeType, quality });

            return new File(
                [blob],
                buildFileNameWithExtension(file.name, getImageExtensionFromMimeType(blob.type || outputMimeType)),
                { type: blob.type || outputMimeType, lastModified: Date.now() },
            );
        }

        const imageDataUrl = await blobToDataUrl(file);
        const image = await loadImageFromDataUrl(imageDataUrl);

        canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error("Could not get image context.");
        }

        context.drawImage(image, 0, 0);
        const blob = await canvasToBlob(canvas, outputMimeType, quality);

        return new File(
            [blob],
            buildFileNameWithExtension(file.name, getImageExtensionFromMimeType(blob.type || outputMimeType)),
            { type: blob.type || outputMimeType, lastModified: Date.now() },
        );
    } catch {
        // Do not block the upload if sanitization fails.
        return file;
    }
};

const clampInt = (value, min = 0) => {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) return min;
    return Math.max(min, parsed);
};

const normalizeType = (value) => {
    const normalized = (value || "").toString().trim().toLowerCase();

    if (
        normalized === "motorbike" ||
        normalized === "motor bike" ||
        normalized === "motorbikes" ||
        normalized === "motor bikes" ||
        normalized === "motorcycle" ||
        normalized === "motorcycles" ||
        normalized.includes("motorbike") ||
        normalized.includes("motor bike") ||
        normalized.includes("motorcycle")
    ) {
        return "motorbike";
    }
    if (normalized === "bike") return "bike";
    if (
        normalized === "historic" ||
        normalized === "historic find" ||
        normalized === "historic value" ||
        normalized === "historically significant" ||
        normalized === "artifact" ||
        normalized === "artefact" ||
        normalized.includes("historic") ||
        normalized.includes("artifact") ||
        normalized.includes("artefact")
    ) {
        return "historic";
    }
    if (
        normalized === "trolley" ||
        normalized === "trolly" ||
        normalized === "trolleys" ||
        normalized === "trollys" ||
        normalized.includes("trolley") ||
        normalized.includes("trolly")
    ) {
        return "trolley";
    }
    if (normalized === "other" || normalized === "misc") return "misc";

    return "misc";
};

const getIcon = (type, isRecovered) => {
    const normalizedType = normalizeType(type);

    const iconMap = {
        bike: "🚲",
        historic: "🏺",
        motorbike: "🏍️",
        trolley: "🛒",
        misc: "🧰",
    };

    const colors = {
        bike: "#3498db",
        historic: "#a16207",
        motorbike: "#dc2626",
        trolley: "#e67e22",
        misc: "#7f8c8d",
    };

    const baseColor = colors[normalizedType] || colors.misc;
    const emoji = iconMap[normalizedType] || iconMap.misc;
    const ringColor = isRecovered ? "#2ecc71" : baseColor;
    const opacity = isRecovered ? 0.8 : 1;

    if (normalizedType === "historic") {
        return L.divIcon({
            className: "cleanup-marker cleanup-marker-historic",
            html: `
                <div style="position: relative; width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; border-radius: 14px; border: 2px solid ${ringColor}; background: linear-gradient(180deg, #fffaf0 0%, #fef3c7 100%); box-shadow: 0 4px 12px rgba(146,64,14,0.25); font-size: 18px; opacity: ${opacity}; transform: rotate(-8deg);">
                    <span style="transform: rotate(8deg);">${emoji}</span>
                    <span style="position: absolute; top: -5px; left: -5px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px; background: ${isRecovered ? "#2ecc71" : "#92400e"}; color: #ffffff; font-size: 9px; font-weight: 800; line-height: 18px; text-align: center; border: 1px solid #ffffff; letter-spacing: 0.04em;">HF</span>
                    ${
                        isRecovered
                            ? '<span style="position: absolute; bottom: -3px; right: -3px; width: 16px; height: 16px; border-radius: 50%; background: #2ecc71; color: white; font-size: 11px; line-height: 16px; text-align: center; border: 1px solid #fff;">✓</span>'
                            : ""
                    }
                </div>
            `,
            iconSize: [38, 38],
            iconAnchor: [19, 19],
        });
    }

    return L.divIcon({
        className: "cleanup-marker",
        html: `
            <div style="position: relative; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 3px solid ${ringColor}; background: #ffffff; box-shadow: 0 2px 8px rgba(0,0,0,0.25); font-size: 18px; opacity: ${opacity};">
                <span>${emoji}</span>
                ${
                    isRecovered
                        ? '<span style="position: absolute; bottom: -2px; right: -2px; width: 16px; height: 16px; border-radius: 50%; background: #2ecc71; color: white; font-size: 11px; line-height: 16px; text-align: center; border: 1px solid #fff;">✓</span>'
                        : ""
                }
            </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 17],
    });
};

const getStationIcon = () =>
    L.divIcon({
        className: "ea-station-marker",
        html: `
            <div style="width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; transform: rotate(45deg); border-radius: 8px; border: 2px solid #0f766e; background: linear-gradient(180deg, #ffffff 0%, #ecfeff 100%); box-shadow: 0 3px 10px rgba(15,118,110,0.3);">
                <span style="transform: rotate(-45deg); color: #0f766e; font-size: 20px; font-weight: 700; line-height: 1;">≈</span>
            </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
    });

const getFlowStationIcon = () =>
    L.divIcon({
        className: "ea-flow-station-marker",
        html: `
            <div style="width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; transform: rotate(45deg); border-radius: 8px; border: 2px solid #0369a1; background: linear-gradient(180deg, #ffffff 0%, #e0f2fe 100%); box-shadow: 0 3px 10px rgba(3,105,161,0.32);">
                <span style="transform: rotate(-45deg); color: #0369a1; font-size: 18px; font-weight: 800; line-height: 1;">F</span>
            </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
    });

const getPoiIcon = (isHistoric = false, isMuseum = false) => {
    let emoji = "📍";
    let color = "#0f766e";
    let borderColor = "#0f766e";
    let bgGradient = "#f0fdfa 0%, #ccfbf1 100%";
    let shadowColor = "rgba(15, 118, 110, 0.28)";
    let className = "poi-marker";

    if (isMuseum) {
        emoji = "🏛️";
        color = "#581c87";
        borderColor = "#7c3aed";
        bgGradient = "#f5f3ff 0%, #ede9fe 100%";
        shadowColor = "rgba(92, 28, 135, 0.28)";
        className = "museum-poi-marker";
    } else if (isHistoric) {
        emoji = "📜";
        color = "#9a3412";
        borderColor = "#8b5e34";
        bgGradient = "#fff7ed 0%, #ffedd5 100%";
        shadowColor = "rgba(154, 52, 18, 0.28)";
        className = "historical-poi-marker";
    }

    return L.divIcon({
        className,
        html: `
            <div style="width: 38px; height: 38px; display: flex; align-items: center; justify-content: center; transform: rotate(45deg); border-radius: 8px; border: 2px solid ${borderColor}; background: linear-gradient(180deg, ${bgGradient}); box-shadow: 0 3px 10px ${shadowColor};">
                <span style="transform: rotate(-45deg); color: ${color}; font-size: 18px; font-weight: 800; line-height: 1;">${emoji}</span>
            </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
    });
};

const getContributorIcon = (logoUrl, businessName) => {
    const hasLogo = typeof logoUrl === "string" && logoUrl.trim();
    const safeLogoUrl = hasLogo ? logoUrl.replace(/"/g, "&quot;") : "";
    const safeBusinessName = String(businessName || "Business")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const initials = String(businessName || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part.charAt(0).toUpperCase())
        .join("") || "?";

    return L.divIcon({
        className: "",
        html: `
            <div
                aria-label="Contributor business marker"
                style="
                    position: relative;
                    width: 38px;
                    height: 38px;
                    border-radius: 10px;
                    border: 3px solid #ca8a04;
                    background: linear-gradient(160deg, #fffbeb 0%, #fef3c7 100%);
                    box-shadow: 0 6px 14px rgba(146, 64, 14, 0.24);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-sizing: border-box;
                "
            >
                <span
                    style="
                        width: 24px;
                        height: 24px;
                        border-radius: 6px;
                        border: 1px solid #f59e0b;
                        background: #ffffff;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        overflow: hidden;
                        box-sizing: border-box;
                    "
                >
                    ${hasLogo
                        ? `<img src="${safeLogoUrl}" alt="${safeBusinessName} logo" style="width: 24px; height: 24px; max-width: 24px; max-height: 24px; object-fit: contain; display: block;" />`
                        : `<span style="font-size: 10px; font-weight: 800; color: #92400e; line-height: 1; letter-spacing: 0.04em;">${initials}</span>`}
                </span>
                <span
                    aria-hidden="true"
                    style="
                        position: absolute;
                        top: -5px;
                        right: -5px;
                        width: 14px;
                        height: 14px;
                        border-radius: 999px;
                        border: 2px solid #fffbeb;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                        background: #facc15;
                        color: #78350f;
                        font-size: 8px;
                        font-weight: 800;
                        line-height: 1;
                    "
                >★</span>
            </div>
        `,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
        popupAnchor: [0, -19],
    });
};

const formatCoordinate = (value, digits = 6) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed.toFixed(digits);
};

function DetailBadge({ label, value, tone = "neutral", compact = false }) {
    const palette = {
        neutral: {
            border: "#dbe3ee",
            background: "#f8fafc",
            label: "#64748b",
            value: "#0f172a",
        },
        success: {
            border: "#bbf7d0",
            background: "#f0fdf4",
            label: "#15803d",
            value: "#14532d",
        },
        warning: {
            border: "#fde68a",
            background: "#fffbeb",
            label: "#b45309",
            value: "#78350f",
        },
    };

    const colors = palette[tone] || palette.neutral;

    return (
        <div
            style={{
                display: "grid",
                gap: compact ? "2px" : "3px",
                minWidth: 0,
                width: "100%",
                padding: compact ? "7px 9px" : "8px 10px",
                borderRadius: "12px",
                border: `1px solid ${colors.border}`,
                background: colors.background,
                boxSizing: "border-box",
            }}
        >
            <span
                style={{
                    fontSize: compact ? "0.67rem" : "0.7rem",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: colors.label,
                }}
            >
                {label}
            </span>
            <span
                style={{
                    fontSize: compact ? "0.86rem" : "0.92rem",
                    fontWeight: 700,
                    color: colors.value,
                    minWidth: 0,
                    overflowWrap: "anywhere",
                }}
            >
                {value}
            </span>
        </div>
    );
}

function LocationDetailsBlock({
    gps,
    geoLookup,
    isResolving,
    mapsUrl,
    mapPoint,
    compact = false,
    inverted = false,
    w3wAddress = null,
}) {
    const colors = inverted
        ? {
              border: "rgba(255,255,255,0.14)",
              background: "rgba(15,23,42,0.42)",
              title: "#f8fafc",
              body: "rgba(241,245,249,0.92)",
              muted: "rgba(226,232,240,0.74)",
              chipBorder: "rgba(191,219,254,0.24)",
              chipBackground: "rgba(255,255,255,0.08)",
              chipLabel: "rgba(191,219,254,0.9)",
              chipValue: "#ffffff",
              rowLabel: "rgba(191,219,254,0.92)",
              rowValue: "#ffffff",
              buttonBorder: "rgba(191,219,254,0.28)",
              buttonBackground: "rgba(255,255,255,0.1)",
              buttonText: "#e0f2fe",
          }
        : {
              border: "#dbe3ee",
              background: "linear-gradient(180deg, #fbfdff 0%, #f8fbff 100%)",
              title: "#0f172a",
              body: "#334155",
              muted: "#64748b",
              chipBorder: "#dbeafe",
              chipBackground: "#eff6ff",
              chipLabel: "#1d4ed8",
              chipValue: "#0f172a",
              rowLabel: "#475569",
              rowValue: "#0f172a",
              buttonBorder: "#cbd5e1",
              buttonBackground: "#ffffff",
              buttonText: "#0f172a",
          };

    const locationTitle = isResolving && !geoLookup ? "Locating nearby area..." : geoLookup?.label || "Lancaster, Lancashire";
    const gpsText = gps ? `${formatCoordinate(gps.latitude)}, ${formatCoordinate(gps.longitude)}` : null;
    const mapPointText = mapPoint
        ? `${formatCoordinate(mapPoint.latitude, 5)}, ${formatCoordinate(mapPoint.longitude, 5)}`
        : null;
    const metadata = [
        geoLookup?.postcode ? { label: "Postcode", value: geoLookup.postcode } : null,
        geoLookup?.countryCode ? { label: "Country", value: geoLookup.countryCode } : null,
    ].filter(Boolean);

    if (!gps && !mapPoint) {
        return (
            <div
                style={{
                    padding: compact ? "10px 11px" : "12px 13px",
                    borderRadius: "14px",
                    border: `1px solid ${colors.border}`,
                    background: colors.background,
                    color: colors.muted,
                    fontSize: compact ? "0.78rem" : "0.82rem",
                }}
            >
                Location not available.
            </div>
        );
    }

    return (
        <div
            style={{
                display: "grid",
                gap: compact ? "8px" : "10px",
                padding: compact ? "10px 11px" : "12px 13px",
                borderRadius: "14px",
                border: `1px solid ${colors.border}`,
                background: colors.background,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "10px",
                    flexWrap: "wrap",
                }}
            >
                <div style={{ display: "grid", gap: "4px", minWidth: 0 }}>
                    <span
                        style={{
                            fontSize: compact ? "0.67rem" : "0.7rem",
                            fontWeight: 700,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            color: colors.muted,
                        }}
                    >
                        Location
                    </span>
                    <span style={{ fontSize: compact ? "0.88rem" : "0.94rem", fontWeight: 700, color: colors.title }}>
                        {locationTitle}
                    </span>
                </div>

                {mapsUrl ? (
                    <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            minHeight: compact ? "34px" : "36px",
                            padding: compact ? "0 12px" : "0 13px",
                            borderRadius: "999px",
                            border: `1px solid ${colors.buttonBorder}`,
                            background: colors.buttonBackground,
                            color: colors.buttonText,
                            textDecoration: "none",
                            fontSize: compact ? "0.78rem" : "0.82rem",
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                        }}
                    >
                        Open in Maps
                        <span aria-hidden="true" style={{ fontSize: "0.95em", lineHeight: 1 }}>↗</span>
                    </a>
                ) : null}
            </div>

            {metadata.length ? (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {metadata.map((item) => (
                        <div
                            key={item.label}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "5px 9px",
                                borderRadius: "999px",
                                border: `1px solid ${colors.chipBorder}`,
                                background: colors.chipBackground,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: compact ? "0.67rem" : "0.69rem",
                                    fontWeight: 700,
                                    letterSpacing: "0.04em",
                                    textTransform: "uppercase",
                                    color: colors.chipLabel,
                                }}
                            >
                                {item.label}
                            </span>
                            <span style={{ fontSize: compact ? "0.76rem" : "0.8rem", fontWeight: 700, color: colors.chipValue }}>
                                {item.value}
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}

            <div style={{ display: "grid", gap: "5px" }}>
                {gpsText ? (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "baseline" }}>
                        <span
                            style={{
                                minWidth: compact ? "34px" : "40px",
                                fontSize: compact ? "0.72rem" : "0.75rem",
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                textTransform: "uppercase",
                                color: colors.rowLabel,
                            }}
                        >
                            GPS
                        </span>
                        <span style={{ fontSize: compact ? "0.8rem" : "0.83rem", color: colors.rowValue }}>
                            {gpsText}
                        </span>
                    </div>
                ) : null}

                {gpsText && w3wAddress ? (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "baseline" }}>
                        <span
                            style={{
                                minWidth: compact ? "34px" : "40px",
                                fontSize: compact ? "0.72rem" : "0.75rem",
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                textTransform: "uppercase",
                                color: colors.rowLabel,
                            }}
                        >
                            W3W
                        </span>
                        <a
                            href={`https://what3words.com/${w3wAddress}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                                fontSize: compact ? "0.8rem" : "0.83rem",
                                textDecoration: "none",
                                color: colors.rowValue,
                            }}
                        >
                            <span style={{ color: "#E11D1C", fontWeight: 700 }}>///</span>{w3wAddress}
                        </a>
                    </div>
                ) : null}

                {mapPointText ? (
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "baseline" }}>
                        <span
                            style={{
                                minWidth: compact ? "58px" : "64px",
                                fontSize: compact ? "0.72rem" : "0.75rem",
                                fontWeight: 700,
                                letterSpacing: "0.04em",
                                textTransform: "uppercase",
                                color: colors.rowLabel,
                            }}
                        >
                            Map Pin
                        </span>
                        <span style={{ fontSize: compact ? "0.8rem" : "0.83rem", color: colors.rowValue }}>
                            {mapPointText}
                        </span>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

const pendingPlacementIcon = L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="25" height="41" viewBox="0 0 25 41">
            <path fill="#d92d20" stroke="#9f1239" stroke-width="1.2" d="M12.5 1.5C6.4 1.5 1.5 6.42 1.5 12.49c0 8.72 11 26.98 11 26.98s11-18.26 11-26.98C23.5 6.42 18.6 1.5 12.5 1.5Z"/>
            <circle cx="12.5" cy="12.5" r="4.6" fill="#ffffff" fill-opacity="0.96"/>
        </svg>
    `)}`,
    shadowUrl: markerShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41],
});

function PendingPlacementOverlay({
    pendingLocation,
    pendingItemType,
    pendingCount,
    pendingEstimatedWeight,
    isSavingItem,
    isPickingImage,
    uploadProgressText,
    isMobile,
    controlFontSize,
    touchButtonSize,
    setPendingCount,
    setPendingEstimatedWeight,
    setPendingItemType,
    setPendingLocation,
    handleTypePick,
    markOverlayInteraction,
    overlayPortalElement,
    w3wWords,
    w3wLoading,
    onFetchW3W,
}) {
    const map = useMap();
    const panelRef = useRef(null);
    const rafRef = useRef(null);
    const isBusy = isSavingItem || isPickingImage;
    const [panelPosition, setPanelPosition] = useState({
        left: 12,
        top: 12,
        arrowLeft: 28,
        placement: "above",
        ready: false,
    });

    useEffect(() => {
        if (!panelRef.current) return undefined;

        const panelElement = panelRef.current;
        const markInteraction = () => {
            markOverlayInteraction();
        };

        const stopEvent = (event) => {
            L.DomEvent.stopPropagation(event);
        };

        L.DomEvent.disableClickPropagation(panelElement);
        L.DomEvent.disableScrollPropagation(panelElement);
        panelElement.addEventListener("pointerdown", markInteraction);
        panelElement.addEventListener("mousedown", markInteraction);
        panelElement.addEventListener("touchstart", markInteraction, { passive: true });
        panelElement.addEventListener("pointerdown", stopEvent);
        panelElement.addEventListener("touchstart", stopEvent, { passive: true });

        return () => {
            panelElement.removeEventListener("pointerdown", markInteraction);
            panelElement.removeEventListener("mousedown", markInteraction);
            panelElement.removeEventListener("touchstart", markInteraction);
            panelElement.removeEventListener("pointerdown", stopEvent);
            panelElement.removeEventListener("touchstart", stopEvent);
        };
    }, [markOverlayInteraction]);

    useEffect(() => {
        if (!pendingLocation) return undefined;

        if (isMobile) {
            setPanelPosition((prev) => ({ ...prev, ready: true }));
            return undefined;
        }

        const updatePosition = () => {
            const container = map.getContainer();
            const point = map.latLngToContainerPoint([pendingLocation.y, pendingLocation.x]);
            const panelWidth = panelRef.current?.offsetWidth || Math.min(container.clientWidth - 24, isMobile ? 288 : 320);
            const panelHeight = panelRef.current?.offsetHeight || 220;
            const gap = isMobile ? 18 : 22;
            const minInset = 12;
            const maxLeft = Math.max(minInset, container.clientWidth - panelWidth - minInset);
            const preferredLeft = point.x + 18;
            const left = Math.min(Math.max(preferredLeft, minInset), maxLeft);

            let top = point.y - panelHeight - gap;
            let placement = "above";
            if (top < minInset) {
                top = point.y + gap;
                placement = "below";
            }

            const maxTop = Math.max(minInset, container.clientHeight - panelHeight - minInset);
            top = Math.min(Math.max(top, minInset), maxTop);
            const arrowLeft = Math.min(Math.max(point.x - left, 24), panelWidth - 24);

            setPanelPosition({ left, top, arrowLeft, placement, ready: true });
        };

        const scheduleUpdate = () => {
            if (rafRef.current !== null) return;

            rafRef.current = window.requestAnimationFrame(() => {
                rafRef.current = null;
                updatePosition();
            });
        };

        scheduleUpdate();
        map.on("move", scheduleUpdate);
        map.on("zoom", scheduleUpdate);
        map.on("resize", scheduleUpdate);

        return () => {
            if (rafRef.current !== null) {
                window.cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }

            map.off("move", scheduleUpdate);
            map.off("zoom", scheduleUpdate);
            map.off("resize", scheduleUpdate);
        };
    }, [map, pendingLocation, pendingItemType, pendingCount, pendingEstimatedWeight, isMobile, isBusy]);

    if (!pendingLocation) return null;

    const panelNode = (
        <div
            ref={panelRef}
            style={{
                position: isMobile ? "fixed" : "absolute",
                left: isMobile ? "8px" : `${panelPosition.left}px`,
                right: isMobile ? "8px" : "auto",
                bottom: isMobile ? "calc(env(safe-area-inset-bottom, 0px) + 8px)" : "auto",
                top: isMobile ? "auto" : `${panelPosition.top}px`,
                width: isMobile ? "auto" : "320px",
                maxHeight: isMobile ? "62svh" : "none",
                overflowY: isMobile ? "auto" : "visible",
                padding: isMobile ? "12px" : "10px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: isMobile ? "16px" : "10px",
                background: "rgba(248,250,252,0.98)",
                boxShadow: "0 14px 32px rgba(15,23,42,0.18)",
                backdropFilter: "blur(6px)",
                zIndex: isMobile ? 1400 : 1100,
                boxSizing: "border-box",
                opacity: panelPosition.ready ? 1 : 0,
                transform: panelPosition.ready ? "translateY(0)" : "translateY(4px)",
                transition: "opacity 140ms ease, transform 180ms ease",
            }}
        >
            {!isMobile ? (
                <div
                    aria-hidden="true"
                    style={{
                        position: "absolute",
                        left: `${panelPosition.arrowLeft}px`,
                        width: "14px",
                        height: "14px",
                        background: "rgba(248,250,252,0.98)",
                        borderLeft: "1px solid #cbd5e1",
                        borderTop: "1px solid #cbd5e1",
                        transform: panelPosition.placement === "above"
                            ? "translateX(-50%) translateY(50%) rotate(225deg)"
                            : "translateX(-50%) translateY(-50%) rotate(45deg)",
                        boxShadow: panelPosition.placement === "above"
                            ? "4px 4px 12px rgba(15,23,42,0.08)"
                            : "-4px -4px 12px rgba(15,23,42,0.08)",
                        bottom: panelPosition.placement === "above" ? "0" : "auto",
                        top: panelPosition.placement === "below" ? "0" : "auto",
                        zIndex: -1,
                    }}
                />
            ) : null}
            <div
                style={{
                    fontSize: "0.9rem",
                    fontWeight: 700,
                    color: "#1e293b",
                    marginBottom: "8px",
                }}
            >
                {pendingItemType
                    ? `Add a photo for this ${TYPE_LABELS[pendingItemType] || "item"}`
                    : "Choose item type for this location"}
            </div>
            {(w3wLoading || w3wWords) ? (
                <div style={{ fontSize: "0.77rem", marginBottom: "6px", lineHeight: 1.4 }}>
                    {w3wLoading ? (
                        <span style={{ color: "#94a3b8" }}>
                            <span style={{ color: "#E11D1C", fontWeight: 700 }}>///</span> resolving…
                        </span>
                    ) : (
                        <a
                            href={`https://what3words.com/${w3wWords}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ textDecoration: "none", color: "#0f172a" }}
                        >
                            <span style={{ color: "#E11D1C", fontWeight: 700 }}>///</span>{w3wWords}
                        </a>
                    )}
                </div>
            ) : (
                <button
                    type="button"
                    onClick={onFetchW3W}
                    disabled={isBusy}
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "5px",
                        marginBottom: "6px",
                        border: "1px solid #e5e7eb",
                        borderRadius: "6px",
                        background: "#fff",
                        padding: "3px 8px 3px 4px",
                        cursor: isBusy ? "not-allowed" : "pointer",
                        opacity: isBusy ? 0.5 : 1,
                    }}
                >
                    <img src={w3wLogo} alt="what3words" style={{ height: "18px", width: "auto", display: "block" }} />
                    <span style={{ fontSize: "0.73rem", color: "#475569", fontWeight: 600 }}>Get address</span>
                </button>
            )}
            <div
                style={{
                    fontSize: "0.8rem",
                    color: "#64748b",
                    marginBottom: "8px",
                    lineHeight: 1.35,
                }}
            >
                Tap another spot on the map to move the pin before saving.
            </div>
            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "8px",
                    flexWrap: "wrap",
                }}
            >
                <span style={{ fontSize: "0.85rem", color: "#334155" }}>
                    How many items here?
                </span>
                <button
                    onClick={() => setPendingCount((prev) => Math.max(1, prev - 1))}
                    disabled={isBusy}
                    style={{
                        border: "1px solid #94a3b8",
                        background: "#fff",
                        borderRadius: "6px",
                        width: touchButtonSize,
                        height: touchButtonSize,
                        fontWeight: 700,
                        cursor: isBusy ? "not-allowed" : "pointer",
                    }}
                >
                    -
                </button>
                <strong style={{ minWidth: "24px", textAlign: "center" }}>
                    {pendingCount}
                </strong>
                <button
                    onClick={() => setPendingCount((prev) => prev + 1)}
                    disabled={isBusy}
                    style={{
                        border: "1px solid #94a3b8",
                        background: "#fff",
                        borderRadius: "6px",
                        width: touchButtonSize,
                        height: touchButtonSize,
                        fontWeight: 700,
                        cursor: isBusy ? "not-allowed" : "pointer",
                    }}
                >
                    +
                </button>
            </div>
            {pendingItemType ? (
                <div style={{ marginBottom: "10px" }}>
                    <label style={{ fontSize: "0.8rem", color: "#475569", display: "block" }}>
                        Estimated weight per item (kg)
                    </label>
                    <input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={pendingEstimatedWeight}
                        onChange={(event) => setPendingEstimatedWeight(event.target.value)}
                        disabled={isBusy}
                        style={{
                            width: "100%",
                            marginTop: "4px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "6px",
                            padding: "8px",
                            boxSizing: "border-box",
                            fontSize: controlFontSize,
                        }}
                    />
                    <div style={{ marginTop: "4px", fontSize: "0.74rem", color: "#64748b", lineHeight: 1.35 }}>
                        Defaults to {formatWeightKg(getDefaultWeightForType(pendingItemType))} for {TYPE_PLURAL_LABELS[pendingItemType] || "items"}.
                    </div>
                </div>
            ) : null}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {pendingItemType ? (
                    <>
                        <button
                            onClick={() => handleTypePick(pendingItemType, "camera")}
                            disabled={isBusy}
                            style={{
                                border: "1px solid #2563eb",
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                padding: isMobile ? "10px 14px" : "8px 12px",
                                borderRadius: "8px",
                                fontSize: controlFontSize,
                                fontWeight: 700,
                                cursor: isBusy ? "not-allowed" : "pointer",
                                opacity: isBusy ? 0.6 : 1,
                            }}
                        >
                            Use Camera
                        </button>
                        <button
                            onClick={() => handleTypePick(pendingItemType, "gallery")}
                            disabled={isBusy}
                            style={{
                                border: "1px solid #94a3b8",
                                background: "#fff",
                                color: "#0f172a",
                                padding: isMobile ? "10px 14px" : "8px 12px",
                                borderRadius: "8px",
                                fontSize: controlFontSize,
                                fontWeight: 700,
                                cursor: isBusy ? "not-allowed" : "pointer",
                                opacity: isBusy ? 0.6 : 1,
                            }}
                        >
                            Choose From Gallery
                        </button>
                        <button
                            onClick={() => {
                                setPendingItemType(null);
                                setPendingEstimatedWeight("");
                            }}
                            disabled={isBusy}
                            style={{
                                border: "1px solid #cbd5e1",
                                background: "transparent",
                                color: "#475569",
                                padding: isMobile ? "10px 14px" : "8px 12px",
                                borderRadius: "8px",
                                fontSize: controlFontSize,
                                fontWeight: 600,
                                cursor: isBusy ? "not-allowed" : "pointer",
                                opacity: isBusy ? 0.6 : 1,
                            }}
                        >
                            Back
                        </button>
                    </>
                ) : (
                    <>
                        {[
                            { key: "bike", label: "🚲 Bike" },
                            { key: "historic", label: "🏺 Historic find" },
                            { key: "motorbike", label: "🏍️ Motorbike" },
                            { key: "trolley", label: "🛒 Trolley" },
                            { key: "misc", label: "🧰 Misc" },
                        ].map((option) => (
                            <button
                                key={option.key}
                                onClick={() => {
                                    setPendingItemType(option.key);
                                    setPendingEstimatedWeight(String(getDefaultWeightForType(option.key)));
                                }}
                                disabled={isBusy}
                                style={{
                                    border: "1px solid #94a3b8",
                                    background: "#fff",
                                    color: "#0f172a",
                                    padding: isMobile ? "10px 14px" : "8px 12px",
                                    borderRadius: "8px",
                                    fontSize: controlFontSize,
                                    fontWeight: 700,
                                    cursor: isBusy ? "not-allowed" : "pointer",
                                    opacity: isBusy ? 0.6 : 1,
                                }}
                            >
                                {option.label}
                            </button>
                        ))}
                    </>
                )}
                <button
                    onClick={() => {
                        setPendingItemType(null);
                        setPendingEstimatedWeight("");
                        setPendingLocation(null);
                    }}
                    disabled={isBusy}
                    style={{
                        border: "1px solid #cbd5e1",
                        background: "transparent",
                        color: "#475569",
                        padding: isMobile ? "10px 14px" : "8px 12px",
                        borderRadius: "8px",
                        fontSize: controlFontSize,
                        fontWeight: 600,
                        cursor: isBusy ? "not-allowed" : "pointer",
                        opacity: isBusy ? 0.6 : 1,
                    }}
                >
                    Cancel
                </button>
            </div>
            {(isBusy || uploadProgressText) && (
                <div
                    style={{
                        marginTop: "8px",
                        fontSize: "0.8rem",
                        color: "#64748b",
                    }}
                >
                    {uploadProgressText || "Uploading and saving item..."}
                </div>
            )}
        </div>
    );

    if (overlayPortalElement) {
        return createPortal(panelNode, overlayPortalElement);
    }

    return panelNode;
}

function PublicReportOverlay({
    reportLocation,
    reportNote,
    reportStatus,
    isMobile,
    onNoteChange,
    onOpenMessenger,
    onOpenEmail,
    onCopyReportText,
    onCancel,
    markOverlayInteraction,
    hasMessengerTarget,
    hasEmailTarget,
    overlayPortalElement,
}) {
    const map = useMap();
    const panelRef = useRef(null);
    const rafRef = useRef(null);
    const [panelPosition, setPanelPosition] = useState({
        left: 12,
        top: 12,
        arrowLeft: 28,
        placement: "above",
        ready: false,
    });

    useEffect(() => {
        if (!panelRef.current) return undefined;

        const panelElement = panelRef.current;
        const markInteraction = () => {
            markOverlayInteraction();
        };

        const stopEvent = (event) => {
            L.DomEvent.stopPropagation(event);
        };

        L.DomEvent.disableClickPropagation(panelElement);
        L.DomEvent.disableScrollPropagation(panelElement);
        panelElement.addEventListener("pointerdown", markInteraction);
        panelElement.addEventListener("mousedown", markInteraction);
        panelElement.addEventListener("touchstart", markInteraction, { passive: true });
        panelElement.addEventListener("pointerdown", stopEvent);
        panelElement.addEventListener("touchstart", stopEvent, { passive: true });

        return () => {
            panelElement.removeEventListener("pointerdown", markInteraction);
            panelElement.removeEventListener("mousedown", markInteraction);
            panelElement.removeEventListener("touchstart", markInteraction);
            panelElement.removeEventListener("pointerdown", stopEvent);
            panelElement.removeEventListener("touchstart", stopEvent);
        };
    }, [markOverlayInteraction]);

    useEffect(() => {
        if (!reportLocation) return undefined;

        if (isMobile) {
            setPanelPosition((prev) => ({ ...prev, ready: true }));
            return undefined;
        }

        const updatePosition = () => {
            const container = map.getContainer();
            const point = map.latLngToContainerPoint([reportLocation.y, reportLocation.x]);
            const panelWidth = panelRef.current?.offsetWidth || 332;
            const panelHeight = panelRef.current?.offsetHeight || 240;
            const gap = 22;
            const minInset = 12;
            const maxLeft = Math.max(minInset, container.clientWidth - panelWidth - minInset);
            const preferredLeft = point.x + 18;
            const left = Math.min(Math.max(preferredLeft, minInset), maxLeft);

            let top = point.y - panelHeight - gap;
            let placement = "above";
            if (top < minInset) {
                top = point.y + gap;
                placement = "below";
            }

            const maxTop = Math.max(minInset, container.clientHeight - panelHeight - minInset);
            top = Math.min(Math.max(top, minInset), maxTop);
            const arrowLeft = Math.min(Math.max(point.x - left, 24), panelWidth - 24);

            setPanelPosition({ left, top, arrowLeft, placement, ready: true });
        };

        const scheduleUpdate = () => {
            if (rafRef.current !== null) return;

            rafRef.current = window.requestAnimationFrame(() => {
                rafRef.current = null;
                updatePosition();
            });
        };

        scheduleUpdate();
        map.on("move", scheduleUpdate);
        map.on("zoom", scheduleUpdate);
        map.on("resize", scheduleUpdate);

        return () => {
            if (rafRef.current !== null) {
                window.cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }

            map.off("move", scheduleUpdate);
            map.off("zoom", scheduleUpdate);
            map.off("resize", scheduleUpdate);
        };
    }, [isMobile, map, reportLocation, reportNote, reportStatus]);

    if (!reportLocation) return null;

    const latText = formatCoordinate(reportLocation.y, 6) || String(reportLocation.y);
    const lngText = formatCoordinate(reportLocation.x, 6) || String(reportLocation.x);

    const panelNode = (
        <div
            ref={panelRef}
            style={{
                position: isMobile ? "fixed" : "absolute",
                left: isMobile ? "8px" : `${panelPosition.left}px`,
                right: isMobile ? "8px" : "auto",
                bottom: isMobile ? "calc(env(safe-area-inset-bottom, 0px) + 8px)" : "auto",
                top: isMobile ? "auto" : `${panelPosition.top}px`,
                width: isMobile ? "auto" : "332px",
                maxHeight: isMobile ? "66svh" : "none",
                overflowY: isMobile ? "auto" : "visible",
                padding: isMobile ? "12px" : "11px 13px",
                border: "1px solid #93c5fd",
                borderRadius: isMobile ? "16px" : "10px",
                background: "rgba(239,246,255,0.97)",
                boxShadow: "0 14px 32px rgba(15,23,42,0.2)",
                backdropFilter: "blur(6px)",
                zIndex: isMobile ? 1400 : 1100,
                boxSizing: "border-box",
                opacity: panelPosition.ready ? 1 : 0,
                transform: panelPosition.ready ? "translateY(0)" : "translateY(4px)",
                transition: "opacity 140ms ease, transform 180ms ease",
            }}
        >
            {!isMobile ? (
                <div
                    aria-hidden="true"
                    style={{
                        position: "absolute",
                        left: `${panelPosition.arrowLeft}px`,
                        width: "14px",
                        height: "14px",
                        background: "rgba(239,246,255,0.97)",
                        borderLeft: "1px solid #93c5fd",
                        borderTop: "1px solid #93c5fd",
                        transform: panelPosition.placement === "above"
                            ? "translateX(-50%) translateY(50%) rotate(225deg)"
                            : "translateX(-50%) translateY(-50%) rotate(45deg)",
                        boxShadow: panelPosition.placement === "above"
                            ? "4px 4px 12px rgba(15,23,42,0.08)"
                            : "-4px -4px 12px rgba(15,23,42,0.08)",
                        bottom: panelPosition.placement === "above" ? "0" : "auto",
                        top: panelPosition.placement === "below" ? "0" : "auto",
                        zIndex: -1,
                    }}
                />
            ) : null}

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    marginBottom: "7px",
                }}
            >
                <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#0f172a" }}>
                    Send this report
                </div>
                <button
                    type="button"
                    onClick={onCancel}
                    aria-label="Close report popup"
                    title="Close"
                    style={{
                        width: "28px",
                        height: "28px",
                        borderRadius: "999px",
                        border: "1px solid #cbd5e1",
                        background: "rgba(255,255,255,0.85)",
                        color: "#475569",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1rem",
                        lineHeight: 1,
                        cursor: "pointer",
                    }}
                >
                    ×
                </button>
            </div>
            <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "0.8rem", color: "#334155", lineHeight: 1.4 }}>
                    GPS to share: {latText}, {lngText}
                </div>
            </div>

            <div
                style={{
                    fontSize: "0.75rem",
                    color: "#1e3a8a",
                    background: "rgba(191,219,254,0.5)",
                    border: "1px solid #bfdbfe",
                    borderRadius: "8px",
                    padding: "7px 8px",
                    lineHeight: 1.35,
                    marginBottom: "9px",
                }}
            >
                Your note and GPS are sent through Facebook Messenger, not saved in this app.
            </div>

            <label style={{ display: "grid", gap: "5px", marginBottom: "9px" }}>
                <span style={{ fontSize: "0.76rem", color: "#334155", fontWeight: 700 }}>
                    Quick details (optional)
                </span>
                <textarea
                    value={reportNote}
                    onChange={(event) => onNoteChange(event.target.value)}
                    maxLength={REPORT_NOTE_MAX_LENGTH}
                    placeholder="Example: shopping trolley snagged in branches near footbridge"
                    style={{
                        border: "1px solid #bfdbfe",
                        borderRadius: "8px",
                        minHeight: "72px",
                        resize: "vertical",
                        padding: "8px",
                        fontSize: "0.82rem",
                        color: "#0f172a",
                        boxSizing: "border-box",
                        width: "100%",
                    }}
                />
                <span style={{ fontSize: "0.72rem", color: "#64748b" }}>
                    {reportNote.length}/{REPORT_NOTE_MAX_LENGTH}
                </span>
            </label>

            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: "8px",
                    alignItems: "stretch",
                }}
            >
                <button
                    type="button"
                    onClick={onOpenMessenger}
                    disabled={!hasMessengerTarget}
                    style={{
                        border: "1px solid #1877f2",
                        background: hasMessengerTarget ? "linear-gradient(135deg, #1d4ed8 0%, #1877f2 65%, #36a2ff 100%)" : "#cbd5e1",
                        color: "#ffffff",
                        borderRadius: "10px",
                        minHeight: isMobile ? "42px" : "38px",
                        padding: isMobile ? "10px 14px" : "8px 13px",
                        fontSize: isMobile ? "0.9rem" : "0.83rem",
                        fontWeight: 700,
                        cursor: hasMessengerTarget ? "pointer" : "not-allowed",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "7px",
                        boxShadow: hasMessengerTarget ? "0 8px 18px rgba(24,119,242,0.34)" : "none",
                        width: "100%",
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2C6.48 2 2 6.15 2 11.29c0 2.93 1.46 5.54 3.74 7.24V22l3.23-1.77c.96.27 1.98.41 3.03.41 5.52 0 10-4.15 10-9.29S17.52 2 12 2Zm1.12 12.51-2.54-2.71-4.95 2.71 5.44-5.76 2.61 2.71 4.87-2.71-5.43 5.76Z"/>
                    </svg>
                    Send via Messenger
                </button>
                <button
                    type="button"
                    onClick={onOpenEmail}
                    disabled={!hasEmailTarget}
                    style={{
                        border: "1px solid #0369a1",
                        background: hasEmailTarget ? "#ecfeff" : "#e2e8f0",
                        color: hasEmailTarget ? "#075985" : "#64748b",
                        borderRadius: "10px",
                        minHeight: isMobile ? "42px" : "38px",
                        padding: isMobile ? "10px 14px" : "8px 13px",
                        fontSize: isMobile ? "0.9rem" : "0.83rem",
                        fontWeight: 700,
                        cursor: hasEmailTarget ? "pointer" : "not-allowed",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "7px",
                        width: "100%",
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.89 2 1.99 2H20c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2Zm0 4-8 5-8-5V6l8 5 8-5v2Z"/>
                    </svg>
                    Send by Email
                </button>
            </div>

            {onCopyReportText ? (
                <button
                    type="button"
                    onClick={onCopyReportText}
                    style={{
                        marginTop: "6px",
                        width: "100%",
                        border: "1px solid #94a3b8",
                        background: "#f8fafc",
                        color: "#334155",
                        borderRadius: "10px",
                        minHeight: isMobile ? "42px" : "38px",
                        padding: isMobile ? "10px 14px" : "8px 13px",
                        fontSize: isMobile ? "0.9rem" : "0.83rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "7px",
                    }}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z"/>
                    </svg>
                    Copy report text
                </button>
            ) : null}

            {!hasMessengerTarget ? (
                <div style={{ marginTop: "8px", fontSize: "0.75rem", color: "#7f1d1d" }}>
                    Reporting is unavailable because Facebook recipient ID is not configured.
                </div>
            ) : null}

            {!hasEmailTarget ? (
                <div style={{ marginTop: "6px", fontSize: "0.75rem", color: "#7f1d1d" }}>
                    Email fallback is unavailable because VITE_COMMUNITY_EMAIL_ACCOUNT is not configured.
                </div>
            ) : null}

            {reportStatus ? (
                <div style={{ marginTop: "8px", fontSize: "0.76rem", color: "#1e3a8a" }}>
                    {reportStatus}
                </div>
            ) : null}
        </div>
    );

    if (overlayPortalElement) {
        return createPortal(panelNode, overlayPortalElement);
    }

    return panelNode;
}

function HeroBanner({
    isMobile,
    authReady,
    currentUser,
    canManageItems,
    authError,
    isAuthActionLoading,
    onSignIn,
    onSignOut,
}) {
    const githubLogin = getGitHubLoginFromUser(currentUser);
    const email = currentUser?.email || "";
    const signedInLabel = githubLogin ? `@${githubLogin}` : email || "Signed in";

    return (
        <div
            style={{
                marginBottom: "4px",
                padding: isMobile ? "10px 10px 8px" : "12px 14px 10px",
                borderRadius: UI_TOKENS.radius.lg,
                border: "1px solid #dbeafe",
                background: "linear-gradient(135deg, #f8fbff 0%, #eef6ff 52%, #f8fafc 100%)",
                boxShadow: UI_TOKENS.shadow.soft,
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: isMobile ? "10px" : "12px",
                    flexWrap: "wrap",
                    marginBottom: "2px",
                }}
            >
                <div
                    style={{
                        flex: "1 1 420px",
                        minWidth: 0,
                    }}
                >
                    <div
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "4px 10px",
                            borderRadius: "999px",
                            background: "rgba(255,255,255,0.75)",
                            border: "1px solid #bfdbfe",
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: "#1d4ed8",
                        }}
                    >
                        <span>River Lune</span>
                        <span style={{ color: "#93c5fd" }}>•</span>
                        <span>Cleanup Tracker</span>
                    </div>

                    <h1
                        style={{
                            fontSize: isMobile ? "1.5rem" : "1.82rem",
                            lineHeight: 1.05,
                            margin: "8px 0 6px",
                            color: "#0f172a",
                            letterSpacing: "-0.03em",
                        }}
                    >
                        River Lune Cleanup
                    </h1>
                    <p style={{ fontSize: "0.9rem", color: "#475569", margin: 0, lineHeight: 1.4 }}>
                        Tap the map to log debris and open markers for counts, photos, and recovery details.
                    </p>
                </div>

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: isMobile ? "stretch" : "flex-end",
                        gap: "6px",
                        flex: isMobile ? "1 1 100%" : "0 0 auto",
                    }}
                >
                    <a
                        href="https://buymeacoffee.com/rivercleanv"
                        target="_blank"
                        rel="noreferrer"
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            border: "1px solid #bfdbfe",
                            background: "linear-gradient(135deg, #ffffff, #eef6ff)",
                            color: "#1d4ed8",
                            borderRadius: "999px",
                            padding: isMobile ? "7px 11px" : "6px 11px",
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            textDecoration: "none",
                            boxShadow: "0 6px 16px rgba(29,78,216,0.12)",
                            whiteSpace: "nowrap",
                        }}
                        aria-label="Support cleanup costs on Ko-fi"
                    >
                        <span aria-hidden="true">❤</span>
                        <span>Support The Cleanup</span>
                    </a>

                    <a
                        href="https://www.facebook.com/profile.php?id=61577489848878"
                        target="_blank"
                        rel="noreferrer"
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            border: "1px solid #1877f2",
                            background: "#1877f2",
                            color: "#fff",
                            borderRadius: "999px",
                            padding: isMobile ? "7px 11px" : "6px 11px",
                            boxShadow: "0 6px 16px rgba(24,119,242,0.25)",
                            textDecoration: "none",
                            whiteSpace: "nowrap",
                        }}
                        aria-label="Facebook page"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                        </svg>
                    </a>

                    {currentUser ? (
                        <button
                            onClick={onSignOut}
                            disabled={!authReady || isAuthActionLoading}
                            style={{
                                border: "1px solid #cbd5e1",
                                background: "#fff",
                                color: "#0f172a",
                                borderRadius: "999px",
                                padding: isMobile ? "8px 12px" : "7px 12px",
                                fontSize: "0.78rem",
                                fontWeight: 700,
                                cursor: !authReady || isAuthActionLoading ? "not-allowed" : "pointer",
                                opacity: !authReady || isAuthActionLoading ? 0.65 : 1,
                                minWidth: isMobile ? "100%" : "182px",
                            }}
                        >
                            Sign Out
                        </button>
                    ) : (
                        <button
                            onClick={onSignIn}
                            disabled={!authReady || isAuthActionLoading}
                            style={{
                                border: "1px solid #0f172a",
                                background: "#111827",
                                color: "#fff",
                                borderRadius: "999px",
                                padding: isMobile ? "8px 12px" : "7px 12px",
                                fontSize: "0.78rem",
                                fontWeight: 700,
                                cursor: !authReady || isAuthActionLoading ? "not-allowed" : "pointer",
                                opacity: !authReady || isAuthActionLoading ? 0.65 : 1,
                                minWidth: isMobile ? "100%" : "182px",
                            }}
                        >
                            Sign In With GitHub
                        </button>
                    )}

                    <div
                        title={!authReady
                            ? "Checking authentication and access state"
                            : canManageItems
                              ? `Edit mode enabled for ${signedInLabel}`
                              : currentUser
                                ? `Signed in as ${signedInLabel} with view-only access`
                                : "Signed out in view-only mode"
                        }
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            borderRadius: "999px",
                            border: `1px solid ${canManageItems ? "#bbf7d0" : "#fde68a"}`,
                            background: canManageItems ? "#f0fdf4" : "#fffbeb",
                            color: canManageItems ? "#166534" : "#92400e",
                            fontSize: "0.74rem",
                            fontWeight: 700,
                            padding: "4px 10px",
                            lineHeight: 1.2,
                            whiteSpace: "nowrap",
                        }}
                    >
                        <span aria-hidden="true">{canManageItems ? "✓" : "🔒"}</span>
                        <span>
                            {!authReady
                                ? "Checking access"
                                : canManageItems
                                  ? "Edit mode"
                                  : "View-only"}
                        </span>
                    </div>
                </div>
            </div>

            {authError ? (
                <div style={{ marginTop: "8px", color: "#b91c1c", fontSize: "0.8rem" }}>
                    {authError}
                </div>
            ) : null}
        </div>
    );
}

function AppTopBar({
    isMobile,
    isSticky,
    authReady,
    currentUser,
    canManageItems,
    isAuthActionLoading,
    onSignIn,
    onSignOut,
    isLoadingItems,
    onOpenContributorPanel,
    onOpenPoiPanel,
    isStatsExpanded,
    onToggleStats,
    mobileStatsSummary,
    children,
}) {
    const signedIn = Boolean(currentUser);
    const syncLabel = isLoadingItems ? "Syncing" : "Up to date";
    const showMobileStatsToggle = isMobile && typeof onToggleStats === "function";
    const showStatsInline = !showMobileStatsToggle || isStatsExpanded;
    const mobileMenuRef = useRef(null);
    const mobileMenuTriggerRef = useRef(null);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    useEffect(() => {
        if (!isMobile) {
            setIsMobileMenuOpen(false);
        }
    }, [isMobile]);

    useEffect(() => {
        if (!isMobileMenuOpen) return undefined;

        const handlePointerDown = (event) => {
            if (!mobileMenuRef.current?.contains(event.target)) {
                setIsMobileMenuOpen(false);
            }
        };

        const handleKeyDown = (event) => {
            if (event.key !== "Escape") return;
            setIsMobileMenuOpen(false);
            mobileMenuTriggerRef.current?.focus();
        };

        document.addEventListener("pointerdown", handlePointerDown);
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isMobileMenuOpen]);

    const desktopActionButtonStyle = {
        borderRadius: UI_TOKENS.radius.pill,
        minHeight: "34px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
    };
    const mobileMenuItemBaseStyle = {
        width: "100%",
        minHeight: "52px",
        borderRadius: "16px",
        padding: "10px 12px",
        textDecoration: "none",
        display: "grid",
        gridTemplateColumns: "26px minmax(0, 1fr) 12px",
        alignItems: "center",
        gap: "10px",
        boxSizing: "border-box",
        border: "1px solid rgba(203,213,225,0.9)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96))",
        color: "#0f172a",
        textAlign: "left",
        boxShadow: "0 1px 0 rgba(255,255,255,0.8) inset",
    };
    const closeMobileMenu = () => setIsMobileMenuOpen(false);
    const handleContributorMenuAction = () => {
        closeMobileMenu();
        onOpenContributorPanel();
    };
    const handlePoiMenuAction = () => {
        closeMobileMenu();
        onOpenPoiPanel();
    };
    const handleAuthMenuAction = () => {
        closeMobileMenu();
        if (signedIn) {
            onSignOut();
            return;
        }
        onSignIn();
    };

    return (
        <div
            style={{
                position: isSticky ? "sticky" : "relative",
                top: isSticky
                    ? `calc(env(safe-area-inset-top, 0px) + ${isMobile ? "2px" : "0px"})`
                    : undefined,
                zIndex: isSticky ? 1050 : "auto",
                marginBottom: 0,
                padding: isMobile ? "8px 10px" : "9px 12px",
                borderRadius: UI_TOKENS.radius.md,
                border: "1px solid rgba(148,163,184,0.35)",
                background: isMobile
                    ? "linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,250,252,0.9))"
                    : "rgba(255,255,255,0.86)",
                backdropFilter: "blur(16px)",
                boxShadow: UI_TOKENS.shadow.soft,
                display: "grid",
                gap: isMobile ? "8px" : "10px",
            }}
        >
            <style>
                {`
                    @keyframes riverTitleShimmer {
                        0% { background-position: 0% 50%; }
                        50% { background-position: 100% 50%; }
                        100% { background-position: 0% 50%; }
                    }

                    @media (prefers-reduced-motion: reduce) {
                        .river-title-shimmer {
                            animation: none !important;
                        }
                    }

                    .app-horizontal-chip-row {
                        scrollbar-width: none;
                        -ms-overflow-style: none;
                    }

                    .app-horizontal-chip-row::-webkit-scrollbar {
                        display: none;
                    }

                    .app-topbar-menu-trigger,
                    .app-topbar-menu-item {
                        transition: transform 140ms ease, box-shadow 180ms ease, background 180ms ease, border-color 180ms ease;
                    }

                    .app-topbar-menu-trigger:hover,
                    .app-topbar-menu-trigger:focus-visible {
                        transform: translateY(-1px);
                        box-shadow: 0 10px 24px rgba(15,23,42,0.14);
                    }

                    .app-topbar-menu-trigger:focus-visible,
                    .app-topbar-menu-item:focus-visible {
                        outline: 2px solid #0f172a;
                        outline-offset: 2px;
                    }

                    .app-topbar-menu-item:hover,
                    .app-topbar-menu-item:focus-visible {
                        border-color: rgba(96,165,250,0.9);
                        background: linear-gradient(180deg, rgba(239,246,255,0.98), rgba(224,242,254,0.96));
                        transform: translateY(-1px);
                    }

                    .app-topbar-menu-chevron {
                        transition: transform 180ms ease;
                    }

                    .app-topbar-menu-trigger[aria-expanded="true"] .app-topbar-menu-chevron {
                        transform: rotate(180deg);
                    }
                `}
            </style>
            <div
                style={{
                    display: "flex",
                    alignItems: isMobile ? "flex-start" : "center",
                    justifyContent: "space-between",
                    gap: isMobile ? "8px" : "10px",
                    flexWrap: "nowrap",
                }}
            >
                <div style={{ minWidth: 0, flex: "1 1 280px" }}>
                    <div
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "7px",
                            padding: isMobile ? "3px 8px" : "4px 9px",
                            borderRadius: "999px",
                            border: "1px solid rgba(147,197,253,0.55)",
                            background: "linear-gradient(135deg, rgba(239,246,255,0.92), rgba(224,242,254,0.78))",
                            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.45)",
                        }}
                    >
                        <span
                            style={{
                                width: "7px",
                                height: "7px",
                                borderRadius: "999px",
                                background: "#0ea5e9",
                                boxShadow: "0 0 10px rgba(14,165,233,0.7)",
                                flexShrink: 0,
                            }}
                        />
                        <span
                            className="river-title-shimmer"
                            style={{
                                fontWeight: 800,
                                letterSpacing: "-0.02em",
                                fontSize: isMobile ? "0.96rem" : "1.03rem",
                                lineHeight: 1,
                                background: "linear-gradient(100deg, #0f172a 5%, #1d4ed8 40%, #0ea5e9 65%, #1d4ed8 85%, #0f172a 100%)",
                                backgroundSize: "220% 220%",
                                animation: "riverTitleShimmer 7s ease-in-out infinite",
                                WebkitBackgroundClip: "text",
                                backgroundClip: "text",
                                color: "transparent",
                            }}
                        >
                            River Lune Cleanup
                        </span>
                    </div>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "7px",
                            marginTop: "2px",
                            fontSize: "0.72rem",
                            color: "#475569",
                        }}
                    >
                        <span
                            style={{
                                width: "8px",
                                height: "8px",
                                borderRadius: UI_TOKENS.radius.pill,
                                background: isLoadingItems ? "#f59e0b" : "#22c55e",
                            }}
                        />
                        <span>{syncLabel}</span>
                        <span style={{ color: "#cbd5e1" }}>•</span>
                        <span>{canManageItems ? "Edit mode" : "View-only"}</span>
                    </div>
                </div>

                {isMobile ? (
                    <div
                        ref={mobileMenuRef}
                        style={{
                            position: "relative",
                            flex: "0 0 auto",
                            alignSelf: "flex-start",
                        }}
                    >
                        <button
                            ref={mobileMenuTriggerRef}
                            type="button"
                            className="app-topbar-menu-trigger"
                            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                            aria-haspopup="dialog"
                            aria-expanded={isMobileMenuOpen}
                            aria-label="Open quick actions menu"
                            style={{
                                border: "1px solid rgba(148,163,184,0.5)",
                                background: isMobileMenuOpen
                                    ? "linear-gradient(135deg, rgba(224,242,254,0.96), rgba(239,246,255,0.98))"
                                    : "linear-gradient(135deg, rgba(255,255,255,0.96), rgba(241,245,249,0.94))",
                                color: "#0f172a",
                                borderRadius: "999px",
                                minHeight: "38px",
                                padding: "0 12px",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "8px",
                                boxShadow: isMobileMenuOpen
                                    ? "0 12px 28px rgba(14,165,233,0.16)"
                                    : "0 8px 22px rgba(15,23,42,0.08)",
                                fontSize: "0.78rem",
                                fontWeight: 800,
                                letterSpacing: "0.01em",
                                cursor: "pointer",
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    display: "inline-flex",
                                    flexDirection: "column",
                                    gap: "3px",
                                }}
                            >
                                <span style={{ width: "12px", height: "2px", borderRadius: "999px", background: "currentColor" }} />
                                <span style={{ width: "12px", height: "2px", borderRadius: "999px", background: "currentColor" }} />
                                <span style={{ width: "12px", height: "2px", borderRadius: "999px", background: "currentColor" }} />
                            </span>
                            <span>Menu</span>
                            <span className="app-topbar-menu-chevron" aria-hidden="true">▾</span>
                        </button>

                        {isMobileMenuOpen ? (
                            <div
                                role="dialog"
                                aria-modal="false"
                                aria-label="Quick actions"
                                style={{
                                    position: "absolute",
                                    top: "calc(100% + 10px)",
                                    right: 0,
                                    width: "min(86vw, 320px)",
                                    padding: "12px",
                                    borderRadius: "22px",
                                    border: "1px solid rgba(191,219,254,0.72)",
                                    background: "linear-gradient(180deg, rgba(255,255,255,0.99), rgba(248,250,252,0.98))",
                                    boxShadow: "0 24px 44px rgba(15,23,42,0.18)",
                                    backdropFilter: "blur(18px)",
                                    display: "grid",
                                    gap: "8px",
                                    zIndex: 1105,
                                }}
                            >
                                <div style={{ display: "grid", gap: "2px", padding: "0 2px 4px" }}>
                                    <span style={{ fontSize: "0.68rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#0369a1" }}>
                                        Quick actions
                                    </span>
                                    <span style={{ fontSize: "0.8rem", color: "#475569", lineHeight: 1.35 }}>
                                        Full labels on mobile without crowding the title bar.
                                    </span>
                                </div>

                                <a
                                    href="https://buymeacoffee.com/rivercleanv"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="app-topbar-menu-item"
                                    onClick={closeMobileMenu}
                                    style={{
                                        ...mobileMenuItemBaseStyle,
                                        borderColor: "#bfdbfe",
                                        background: "linear-gradient(180deg, #eff6ff, #f8fbff)",
                                        color: "#1d4ed8",
                                    }}
                                >
                                    <span aria-hidden="true" style={{ fontSize: "1rem", textAlign: "center" }}>❤</span>
                                    <span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
                                        <span style={{ fontSize: "0.84rem", fontWeight: 800, color: "#0f172a" }}>Support The Cleanup</span>
                                        <span style={{ fontSize: "0.74rem", color: "#475569" }}>Help cover map, hosting, and cleanup costs.</span>
                                    </span>
                                    <span aria-hidden="true" style={{ color: "#94a3b8", fontSize: "0.9rem" }}>↗</span>
                                </a>

                                <a
                                    href="https://www.facebook.com/profile.php?id=61577489848878"
                                    target="_blank"
                                    rel="noreferrer"
                                    className="app-topbar-menu-item"
                                    onClick={closeMobileMenu}
                                    style={{
                                        ...mobileMenuItemBaseStyle,
                                        borderColor: "rgba(24,119,242,0.28)",
                                        background: "linear-gradient(180deg, rgba(239,246,255,0.98), rgba(248,250,252,0.96))",
                                    }}
                                >
                                    <span aria-hidden="true" style={{ color: "#1877f2", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                                        </svg>
                                    </span>
                                    <span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
                                        <span style={{ fontSize: "0.84rem", fontWeight: 800, color: "#0f172a" }}>Facebook Page</span>
                                        <span style={{ fontSize: "0.74rem", color: "#475569" }}>Updates, photos, and community posts.</span>
                                    </span>
                                    <span aria-hidden="true" style={{ color: "#94a3b8", fontSize: "0.9rem" }}>↗</span>
                                </a>

                                <button
                                    type="button"
                                    className="app-topbar-menu-item"
                                    onClick={handleContributorMenuAction}
                                    style={{
                                        ...mobileMenuItemBaseStyle,
                                        borderColor: "rgba(245,158,11,0.4)",
                                        background: "linear-gradient(180deg, #fef3c7, #fffaf0)",
                                        cursor: "pointer",
                                    }}
                                >
                                    <span aria-hidden="true" style={{ fontSize: "1rem", textAlign: "center", color: "#92400e" }}>★</span>
                                    <span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
                                        <span style={{ fontSize: "0.84rem", fontWeight: 800, color: "#0f172a" }}>Contributors</span>
                                        <span style={{ fontSize: "0.74rem", color: "#475569" }}>
                                            {canManageItems ? "Open the contributor manager." : "Browse the current supporter list."}
                                        </span>
                                    </span>
                                    <span aria-hidden="true" style={{ color: "#94a3b8", fontSize: "0.9rem" }}>›</span>
                                </button>

                                {canManageItems ? (
                                    <button
                                        type="button"
                                        className="app-topbar-menu-item"
                                        onClick={handlePoiMenuAction}
                                        style={{
                                            ...mobileMenuItemBaseStyle,
                                            borderColor: "rgba(154,52,18,0.22)",
                                            background: "linear-gradient(180deg, #ffedd5, #fff7ed)",
                                            cursor: "pointer",
                                        }}
                                    >
                                        <span aria-hidden="true" style={{ fontSize: "1rem", textAlign: "center", color: "#9a3412" }}>📍</span>
                                        <span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
                                            <span style={{ fontSize: "0.84rem", fontWeight: 800, color: "#0f172a" }}>POIs</span>
                                            <span style={{ fontSize: "0.74rem", color: "#475569" }}>Manage points of interest and history markers.</span>
                                        </span>
                                        <span aria-hidden="true" style={{ color: "#94a3b8", fontSize: "0.9rem" }}>›</span>
                                    </button>
                                ) : null}

                                <button
                                    type="button"
                                    className="app-topbar-menu-item"
                                    disabled={!authReady || isAuthActionLoading}
                                    onClick={handleAuthMenuAction}
                                    style={{
                                        ...mobileMenuItemBaseStyle,
                                        borderColor: signedIn ? "rgba(203,213,225,0.95)" : "rgba(15,23,42,0.9)",
                                        background: signedIn
                                            ? "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96))"
                                            : "linear-gradient(180deg, rgba(15,23,42,0.98), rgba(30,41,59,0.96))",
                                        color: signedIn ? "#0f172a" : "#fff",
                                        cursor: !authReady || isAuthActionLoading ? "not-allowed" : "pointer",
                                        opacity: !authReady || isAuthActionLoading ? 0.65 : 1,
                                    }}
                                >
                                    <span aria-hidden="true" style={{ fontSize: "0.95rem", textAlign: "center" }}>{signedIn ? "✓" : "↗"}</span>
                                    <span style={{ display: "grid", gap: "2px", minWidth: 0 }}>
                                        <span style={{ fontSize: "0.84rem", fontWeight: 800, color: signedIn ? "#0f172a" : "#fff" }}>
                                            {signedIn ? "Sign Out" : "Sign In With GitHub"}
                                        </span>
                                        <span style={{ fontSize: "0.74rem", color: signedIn ? "#475569" : "rgba(226,232,240,0.9)" }}>
                                            {signedIn ? "Leave edit or view mode on this device." : "Sign in to access editing tools if you have permission."}
                                        </span>
                                    </span>
                                    <span aria-hidden="true" style={{ color: signedIn ? "#94a3b8" : "rgba(226,232,240,0.9)", fontSize: "0.9rem" }}>›</span>
                                </button>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            flexWrap: "wrap",
                            gap: "6px",
                            flex: "0 1 auto",
                            minWidth: 0,
                        }}
                    >
                        <a
                            href="https://buymeacoffee.com/rivercleanv"
                            target="_blank"
                            rel="noreferrer"
                            style={{
                                ...desktopActionButtonStyle,
                                border: "1px solid #bfdbfe",
                                background: "#eff6ff",
                                color: "#1d4ed8",
                                padding: "0 11px",
                                fontSize: "0.74rem",
                                fontWeight: 700,
                                textDecoration: "none",
                            }}
                            aria-label="Support cleanup costs on Ko-fi"
                        >
                            ❤ Support
                        </a>

                        <a
                            href="https://www.facebook.com/profile.php?id=61577489848878"
                            target="_blank"
                            rel="noreferrer"
                            style={{
                                ...desktopActionButtonStyle,
                                border: "1px solid #1877f2",
                                background: "#1877f2",
                                color: "#fff",
                                padding: "0 11px",
                                textDecoration: "none",
                            }}
                            aria-label="Facebook page"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97h-1.514c-1.491 0-1.956.93-1.956 1.886v2.268h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/>
                            </svg>
                        </a>

                        <button
                            type="button"
                            onClick={onOpenContributorPanel}
                            style={{
                                ...desktopActionButtonStyle,
                                border: "1px solid #f59e0b",
                                background: "#fef3c7",
                                color: "#92400e",
                                padding: "0 11px",
                                fontSize: "0.76rem",
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                            aria-label={canManageItems ? "Open contributor manager" : "Open contributors list"}
                        >
                            ★ Contributors
                        </button>

                        {canManageItems ? (
                            <button
                                type="button"
                                onClick={onOpenPoiPanel}
                                style={{
                                    ...desktopActionButtonStyle,
                                    border: "1px solid #9a3412",
                                    background: "#ffedd5",
                                    color: "#9a3412",
                                    padding: "0 11px",
                                    fontSize: "0.76rem",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                                aria-label="Open POI manager"
                            >
                                📍 POIs
                            </button>
                        ) : null}

                        <button
                            type="button"
                            onClick={signedIn ? onSignOut : onSignIn}
                            disabled={!authReady || isAuthActionLoading}
                            style={{
                                ...desktopActionButtonStyle,
                                border: `1px solid ${signedIn ? "#cbd5e1" : "#0f172a"}`,
                                background: signedIn ? "#fff" : "#0f172a",
                                color: signedIn ? "#0f172a" : "#fff",
                                padding: "0 12px",
                                fontSize: "0.76rem",
                                fontWeight: 700,
                                opacity: !authReady || isAuthActionLoading ? 0.65 : 1,
                                cursor: !authReady || isAuthActionLoading ? "not-allowed" : "pointer",
                            }}
                        >
                            {signedIn ? "Sign Out" : "Sign In"}
                        </button>
                    </div>
                )}
            </div>

            {showMobileStatsToggle ? (
                <button
                    type="button"
                    onClick={onToggleStats}
                    aria-expanded={isStatsExpanded}
                    style={{
                        border: "1px solid rgba(125,211,252,0.55)",
                        borderRadius: "14px",
                        background: isStatsExpanded
                            ? "linear-gradient(145deg, rgba(239,246,255,0.98), rgba(224,242,254,0.92))"
                            : "linear-gradient(145deg, rgba(248,250,252,0.96), rgba(241,245,249,0.92))",
                        padding: "8px 10px",
                        display: "grid",
                        gap: "2px",
                        textAlign: "left",
                        color: "#0f172a",
                        boxShadow: isStatsExpanded ? "0 12px 28px rgba(14,165,233,0.12)" : "0 1px 0 rgba(255,255,255,0.85) inset",
                        cursor: "pointer",
                    }}
                >
                    <span
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "10px",
                            fontSize: "0.68rem",
                            fontWeight: 800,
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            color: "#0369a1",
                        }}
                    >
                        <span>River stats</span>
                        <span style={{ fontSize: "0.92rem", color: "#0f172a" }}>
                            {isStatsExpanded ? "▴" : "▾"}
                        </span>
                    </span>
                    <span
                        style={{
                            fontSize: "0.8rem",
                            fontWeight: 700,
                            lineHeight: 1.3,
                            color: "#334155",
                        }}
                    >
                        {mobileStatsSummary}
                    </span>
                </button>
            ) : null}

            {showStatsInline && children ? (
                <div
                    style={isMobile ? {
                        padding: "2px",
                        borderRadius: "16px",
                        background: "linear-gradient(180deg, rgba(255,255,255,0.7), rgba(241,245,249,0.66))",
                    } : undefined}
                >
                    {children}
                </div>
            ) : null}
        </div>
    );
}

function SurfaceCard({ as = "div", style = {}, children, ...props }) {
    const Component = as;

    return (
        <Component
            style={{
                border: "1px solid rgba(148,163,184,0.35)",
                borderRadius: UI_TOKENS.radius.md,
                background: "rgba(255,255,255,0.92)",
                boxShadow: UI_TOKENS.shadow.soft,
                ...style,
            }}
            {...props}
        >
            {children}
        </Component>
    );
}

function SummaryStats({ totals, locationCount, controlFontSize, isMobile, impactStats }) {
    const [activeTooltip, setActiveTooltip] = useState(null);
    const statsRef = useRef(null);
    const mobileTooltipDialogRef = useRef(null);
    const suppressNextStatToggleRef = useRef(false);
    const suppressNextStatToggleTimeoutRef = useRef(null);
    const trolleyWeight = ASSUMED_ITEM_WEIGHTS_KG.trolley;
    const bikeWeight = ASSUMED_ITEM_WEIGHTS_KG.bike;
    const historicWeight = ASSUMED_ITEM_WEIGHTS_KG.historic;
    const motorbikeWeight = ASSUMED_ITEM_WEIGHTS_KG.motorbike;
    const miscWeight = ASSUMED_ITEM_WEIGHTS_KG.misc;
    const totalTrolley = impactStats.totalByType.trolley;
    const totalBike = impactStats.totalByType.bike;
    const totalHistoric = impactStats.totalByType.historic;
    const totalMotorbike = impactStats.totalByType.motorbike;
    const totalMisc = impactStats.totalByType.misc;
    const recoveredTrolley = impactStats.recoveredByType.trolley;
    const recoveredBike = impactStats.recoveredByType.bike;
    const recoveredHistoric = impactStats.recoveredByType.historic;
    const recoveredMotorbike = impactStats.recoveredByType.motorbike;
    const recoveredMisc = impactStats.recoveredByType.misc;
    const remainingTrolley = impactStats.remainingByType.trolley;
    const remainingBike = impactStats.remainingByType.bike;
    const remainingHistoric = impactStats.remainingByType.historic;
    const remainingMotorbike = impactStats.remainingByType.motorbike;
    const remainingMisc = impactStats.remainingByType.misc;
    const remainingScrapValueMin = impactStats.estimatedRemainingKg * CONSERVATIVE_SCRAP_VALUE_GBP_PER_KG.min;
    const remainingScrapValueMax = impactStats.estimatedRemainingKg * CONSERVATIVE_SCRAP_VALUE_GBP_PER_KG.max;
    const recoveredScrapValueMin = impactStats.estimatedRecoveredKg * CONSERVATIVE_SCRAP_VALUE_GBP_PER_KG.min;
    const recoveredScrapValueMax = impactStats.estimatedRecoveredKg * CONSERVATIVE_SCRAP_VALUE_GBP_PER_KG.max;

    useEffect(() => {
        if (!activeTooltip) return undefined;

        const handlePointerDown = (event) => {
            if (statsRef.current?.contains(event.target)) return;
            if (mobileTooltipDialogRef.current?.contains(event.target)) return;
            setActiveTooltip(null);
        };

        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [activeTooltip]);

    useEffect(() => () => {
        if (suppressNextStatToggleTimeoutRef.current) {
            clearTimeout(suppressNextStatToggleTimeoutRef.current);
        }
    }, []);

    const suppressNextStatToggle = () => {
        suppressNextStatToggleRef.current = true;
        if (suppressNextStatToggleTimeoutRef.current) {
            clearTimeout(suppressNextStatToggleTimeoutRef.current);
        }

        suppressNextStatToggleTimeoutRef.current = setTimeout(() => {
            suppressNextStatToggleRef.current = false;
            suppressNextStatToggleTimeoutRef.current = null;
        }, 320);
    };

    const closeActiveTooltip = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        suppressNextStatToggle();
        setActiveTooltip(null);
    };

    const stopTooltipEvent = (event) => {
        event?.stopPropagation?.();
    };

    const tooltipMetricLabelStyle = {
        fontSize: isMobile ? "0.62rem" : "0.66rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
    };
    const tooltipMetricValueStyle = {
        marginTop: "2px",
        fontSize: isMobile ? "0.88rem" : "0.95rem",
        fontWeight: 800,
        lineHeight: 1.1,
    };
    const tooltipBreakdownLabelStyle = {
        fontSize: isMobile ? "0.61rem" : "0.64rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "#64748b",
    };
    const tooltipBreakdownValueStyle = {
        marginTop: "1px",
        fontSize: isMobile ? "0.8rem" : "0.84rem",
        fontWeight: 700,
        color: "#0f172a",
        lineHeight: 1.15,
    };
    const tooltipBreakdownDetailStyle = {
        marginTop: "2px",
        fontSize: isMobile ? "0.64rem" : "0.68rem",
        fontWeight: 600,
        color: "#64748b",
        lineHeight: 1.25,
    };
    const tooltipSummaryStyle = {
        fontSize: isMobile ? "0.68rem" : "0.72rem",
        fontWeight: 600,
        color: "#64748b",
        lineHeight: 1.32,
    };
    const tooltipTones = {
        neutral: { border: "#e2e8f0", background: "#f8fafc", label: "#64748b", value: "#0f172a" },
        success: { border: "#bbf7d0", background: "#f0fdf4", label: "#166534", value: "#166534" },
        warning: { border: "#fde68a", background: "#fffbeb", label: "#92400e", value: "#92400e" },
        danger: { border: "#fecaca", background: "#fef2f2", label: "#b91c1c", value: "#b91c1c" },
        dangerSoft: { border: "#fecaca", background: "#fff1f2", label: "#be123c", value: "#be123c" },
        blue: { border: "#bfdbfe", background: "#eff6ff", label: "#1d4ed8", value: "#1d4ed8" },
        slate: { border: "#cbd5e1", background: "#f8fafc", label: "#475569", value: "#0f172a" },
        teal: { border: "#99f6e4", background: "#f0fdfa", label: "#0f766e", value: "#115e59" },
    };

    const renderTooltipMetricCard = ({ label, value, tone = "neutral" }) => {
        const colors = typeof tone === "string" ? tooltipTones[tone] || tooltipTones.neutral : tone;

        return (
            <div
                style={{
                    padding: isMobile ? "6px 7px" : "7px 8px",
                    borderRadius: UI_TOKENS.radius.sm,
                    border: `1px solid ${colors.border}`,
                    background: colors.background,
                }}
            >
                <div style={{ ...tooltipMetricLabelStyle, color: colors.label }}>
                    {label}
                </div>
                <div style={{ ...tooltipMetricValueStyle, color: colors.value }}>
                    {value}
                </div>
            </div>
        );
    };

    const renderTooltipBreakdown = ({ items, columns = 2 }) => (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: isMobile ? "4px 8px" : "6px 10px",
                padding: isMobile ? "6px 7px" : "7px 8px",
                borderRadius: UI_TOKENS.radius.sm,
                border: "1px solid #e2e8f0",
                background: "#f8fafc",
            }}
        >
            {items.map((item) => (
                <div key={item.label} style={{ minWidth: 0 }}>
                    <div style={tooltipBreakdownLabelStyle}>
                        {item.label}
                    </div>
                    <div style={tooltipBreakdownValueStyle}>
                        {item.value}
                    </div>
                    {item.detail ? <div style={tooltipBreakdownDetailStyle}>{item.detail}</div> : null}
                </div>
            ))}
        </div>
    );

    const buildTooltipContent = ({ metricCards = [], breakdownItems = [], breakdownColumns = 2, summary }) => (
        <div style={{ display: "grid", gap: isMobile ? "6px" : "8px" }}>
            {metricCards.length ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: isMobile ? "6px" : "8px" }}>
                    {metricCards.map((card) => (
                        <div key={card.label}>{renderTooltipMetricCard(card)}</div>
                    ))}
                </div>
            ) : null}
            {breakdownItems.length ? renderTooltipBreakdown({ items: breakdownItems, columns: breakdownColumns }) : null}
            {summary ? <div style={tooltipSummaryStyle}>{summary}</div> : null}
        </div>
    );

    const buildStatusTooltipContent = ({
        totalLabel,
        totalValue,
        totalTone,
        progressLabel,
        progressValue,
        progressTone,
        bikeCount,
        trolleyCount,
        historicCount,
        motorbikeCount,
        miscCount,
        summary,
    }) => buildTooltipContent({
        metricCards: [
            { label: totalLabel, value: totalValue, tone: totalTone },
            { label: progressLabel, value: progressValue, tone: progressTone },
        ],
        breakdownItems: [
            { label: "Bikes", value: bikeCount },
            { label: "Trolleys", value: trolleyCount },
            { label: "Historic", value: historicCount },
            { label: "Motorbikes", value: motorbikeCount },
            { label: "Misc", value: miscCount },
        ],
        summary,
    });

    const historicRecoveryRate = totalHistoric > 0 ? Math.round((recoveredHistoric / totalHistoric) * 100) : 0;
    const recoveredCompletionRate = totals.total > 0 ? Math.round((totals.recovered / totals.total) * 100) : 0;
    const remainingShareRate = totals.total > 0 ? Math.round((totals.remaining / totals.total) * 100) : 0;
    const averageItemsPerLocation = locationCount > 0 ? (totals.total / locationCount).toFixed(1) : "0.0";
    const remainingAverageWeight = totals.remaining > 0 ? formatWeightKg(Math.round(impactStats.estimatedRemainingKg / totals.remaining)) : "0 kg";
    const recoveredAverageWeight = totals.recovered > 0 ? formatWeightKg(Math.round(impactStats.estimatedRecoveredKg / totals.recovered)) : "0 kg";

    const totalTooltipContent = buildTooltipContent({
        metricCards: [
            { label: "Total items", value: totals.total, tone: "neutral" },
            {
                label: "Recovered share",
                value: `${recoveredCompletionRate}%`,
                tone: totals.recovered > 0 ? "blue" : "slate",
            },
        ],
        breakdownItems: [
            { label: "Bikes", value: totalBike },
            { label: "Trolleys", value: totalTrolley },
            { label: "Historic", value: totalHistoric },
            { label: "Motorbikes", value: totalMotorbike },
            { label: "Misc", value: totalMisc },
        ],
        summary:
            totals.total === 0
                ? "No items are currently visible for the active filters"
                : `${totals.recovered} recovered, ${totals.remaining} still in the river across ${locationCount} visible locations`,
    });

    const locationsTooltipContent = buildTooltipContent({
        metricCards: [
            { label: "Visible locations", value: locationCount, tone: "slate" },
            { label: "Items per location", value: averageItemsPerLocation, tone: totals.total > 0 ? "blue" : "neutral" },
        ],
        summary:
            locationCount === 0
                ? "No mapped points match the current filters"
                : `${locationCount} mapped points are currently visible after filtering`,
    });

    const historicTooltipContent = buildTooltipContent({
        metricCards: [
            { label: "Total finds", value: totalHistoric, tone: "neutral" },
            { label: "Recovered", value: recoveredHistoric, tone: "warning" },
            {
                label: "Still in river",
                value: remainingHistoric,
                tone: remainingHistoric > 0 ? "danger" : "success",
            },
            { label: "Recovery progress", value: `${historicRecoveryRate}%`, tone: "blue" },
        ],
        summary:
            totalHistoric === 0
                ? "No historic finds are currently logged"
                : remainingHistoric > 0
                ? `${recoveredHistoric} recovered, ${remainingHistoric} still to recover`
                : "All logged historic finds have been recovered",
    });

    const recoveredTooltipContent = buildStatusTooltipContent({
        totalLabel: "Recovered items",
        totalValue: totals.recovered,
        totalTone: tooltipTones.success,
        progressLabel: "Share of total",
        progressValue: `${recoveredCompletionRate}%`,
        progressTone: tooltipTones.blue,
        bikeCount: recoveredBike,
        trolleyCount: recoveredTrolley,
        historicCount: recoveredHistoric,
        motorbikeCount: recoveredMotorbike,
        miscCount: recoveredMisc,
        summary:
            totals.recovered === 0
                ? "No items have been marked as recovered yet"
                : `${totals.recovered} items recovered across the current filtered area`,
    });

    const remainingTooltipContent = buildStatusTooltipContent({
        totalLabel: "Items in river",
        totalValue: totals.remaining,
        totalTone: totals.remaining > 0 ? tooltipTones.danger : tooltipTones.success,
        progressLabel: "Share of total",
        progressValue: `${remainingShareRate}%`,
        progressTone: totals.remaining > 0 ? tooltipTones.dangerSoft : tooltipTones.success,
        bikeCount: remainingBike,
        trolleyCount: remainingTrolley,
        historicCount: remainingHistoric,
        motorbikeCount: remainingMotorbike,
        miscCount: remainingMisc,
        summary:
            totals.remaining === 0
                ? "No items remain in the river for the current filters"
                : `${totals.remaining} items still need recovery across the current filtered area`,
    });

    const remainingWeightTooltipContent = buildTooltipContent({
        metricCards: [
            { label: "Estimated weight", value: formatWeightKg(Math.round(impactStats.estimatedRemainingKg)), tone: "warning" },
            {
                label: "Scrap value",
                value: `${formatGbp(remainingScrapValueMin)}-${formatGbp(remainingScrapValueMax)}`,
                tone: "blue",
            },
            {
                label: "Avg per item",
                value: remainingAverageWeight,
                tone: totals.remaining > 0 ? "slate" : "neutral",
            },
            {
                label: "Items counted",
                value: totals.remaining,
                tone: totals.remaining > 0 ? "danger" : "success",
            },
        ],
        breakdownItems: [
            {
                label: "Bikes",
                value: formatWeightKg(impactStats.remainingWeightByType.bike),
                detail: `${remainingBike} logged • ${formatWeightKg(bikeWeight)} default each`,
            },
            {
                label: "Trolleys",
                value: formatWeightKg(impactStats.remainingWeightByType.trolley),
                detail: `${remainingTrolley} logged • ${formatWeightKg(trolleyWeight)} default each`,
            },
            {
                label: "Historic",
                value: formatWeightKg(impactStats.remainingWeightByType.historic),
                detail: `${remainingHistoric} logged • ${formatWeightKg(historicWeight)} default each`,
            },
            {
                label: "Motorbikes",
                value: formatWeightKg(impactStats.remainingWeightByType.motorbike),
                detail: `${remainingMotorbike} logged • ${formatWeightKg(motorbikeWeight)} default each`,
            },
            {
                label: "Misc",
                value: formatWeightKg(impactStats.remainingWeightByType.misc),
                detail: `${remainingMisc} logged • ${formatWeightKg(miscWeight)} default each`,
            },
        ],
        summary:
            totals.remaining === 0
                ? "No remaining weight is estimated for the current filters"
                : "Estimated from logged counts and default per-type weights where an item does not have its own recorded weight",
    });

    const removedWeightTooltipContent = buildTooltipContent({
        metricCards: [
            { label: "Estimated weight", value: formatWeightKg(Math.round(impactStats.estimatedRecoveredKg)), tone: "teal" },
            {
                label: "Scrap value",
                value: `${formatGbp(recoveredScrapValueMin)}-${formatGbp(recoveredScrapValueMax)}`,
                tone: "blue",
            },
            {
                label: "Avg per item",
                value: recoveredAverageWeight,
                tone: totals.recovered > 0 ? "slate" : "neutral",
            },
            {
                label: "Items counted",
                value: totals.recovered,
                tone: totals.recovered > 0 ? "success" : "neutral",
            },
        ],
        breakdownItems: [
            {
                label: "Bikes",
                value: formatWeightKg(impactStats.recoveredWeightByType.bike),
                detail: `${recoveredBike} logged • ${formatWeightKg(bikeWeight)} default each`,
            },
            {
                label: "Trolleys",
                value: formatWeightKg(impactStats.recoveredWeightByType.trolley),
                detail: `${recoveredTrolley} logged • ${formatWeightKg(trolleyWeight)} default each`,
            },
            {
                label: "Historic",
                value: formatWeightKg(impactStats.recoveredWeightByType.historic),
                detail: `${recoveredHistoric} logged • ${formatWeightKg(historicWeight)} default each`,
            },
            {
                label: "Motorbikes",
                value: formatWeightKg(impactStats.recoveredWeightByType.motorbike),
                detail: `${recoveredMotorbike} logged • ${formatWeightKg(motorbikeWeight)} default each`,
            },
            {
                label: "Misc",
                value: formatWeightKg(impactStats.recoveredWeightByType.misc),
                detail: `${recoveredMisc} logged • ${formatWeightKg(miscWeight)} default each`,
            },
        ],
        summary:
            totals.recovered === 0
                ? "No recovered weight is estimated for the current filters"
                : "Estimated from recovered counts and default per-type weights where an item does not have its own recorded weight",
    });
    const desktopRightAlignedTooltipIds = new Set(["remaining-weight", "removed-weight"]);

    const renderStatTile = (id, label, valueNode, tooltipContent, valueColor, mobileLabel = label) => {
        const alignTooltipRight = desktopRightAlignedTooltipIds.has(id);
        const visibleLabel = isMobile ? mobileLabel : label;
        const handleStatTileClick = () => {
            if (suppressNextStatToggleRef.current) {
                suppressNextStatToggleRef.current = false;
                if (suppressNextStatToggleTimeoutRef.current) {
                    clearTimeout(suppressNextStatToggleTimeoutRef.current);
                    suppressNextStatToggleTimeoutRef.current = null;
                }
                return;
            }

            setActiveTooltip((prev) => (prev === id ? null : id));
        };

        return (
            <button
                type="button"
                onClick={handleStatTileClick}
                onMouseEnter={() => {
                    if (!isMobile) setActiveTooltip(id);
                }}
                onMouseLeave={() => {
                    if (!isMobile) setActiveTooltip((prev) => (prev === id ? null : prev));
                }}
                style={{
                    position: "relative",
                    width: "100%",
                    border: `1px solid ${activeTooltip === id ? "#93c5fd" : "rgba(203,213,225,0.92)"}`,
                    background: activeTooltip === id
                        ? "linear-gradient(180deg, rgba(239,246,255,0.98), rgba(219,234,254,0.92))"
                        : "linear-gradient(180deg, rgba(255,255,255,0.94), rgba(248,250,252,0.88))",
                    borderRadius: UI_TOKENS.radius.sm,
                    padding: isMobile ? "6px 8px" : "7px 9px",
                    textAlign: "left",
                    color: "#0f172a",
                    cursor: "help",
                    boxShadow: activeTooltip === id ? "0 10px 24px rgba(37,99,235,0.12)" : "0 1px 0 rgba(255,255,255,0.85) inset",
                    minWidth: 0,
                    minHeight: isMobile ? "40px" : "46px",
                    display: "grid",
                    gap: "0",
                    alignContent: "start",
                    transition: "border-color 160ms ease, box-shadow 160ms ease, background 160ms ease, transform 160ms ease",
                    transform: activeTooltip === id ? "translateY(-1px)" : "none",
                }}
                aria-expanded={activeTooltip === id}
                aria-label={`${label}. Tap or hover for breakdown.`}
            >
                <span style={{ display: "block", paddingRight: isMobile ? "15px" : "18px" }}>
                    <span style={{ display: "block", fontSize: isMobile ? "0.54rem" : "0.6rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: "#64748b", lineHeight: 1.05 }}>
                        {visibleLabel}
                    </span>
                    <strong style={{ display: "block", marginTop: isMobile ? "2px" : "3px", fontSize: isMobile ? "0.82rem" : "0.88rem", lineHeight: 1.05, color: valueColor || "#0f172a" }}>
                        {valueNode}
                    </strong>
                </span>
                <span
                    aria-hidden="true"
                    style={{
                        position: "absolute",
                        top: isMobile ? "6px" : "7px",
                        right: isMobile ? "6px" : "8px",
                        width: isMobile ? "14px" : "16px",
                        height: isMobile ? "14px" : "16px",
                        borderRadius: "999px",
                        background: activeTooltip === id ? "#2563eb" : "#cbd5e1",
                        color: activeTooltip === id ? "#fff" : "#334155",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: isMobile ? "0.62rem" : "0.7rem",
                        fontWeight: 700,
                    }}
                >
                    i
                </span>
                {!isMobile && activeTooltip === id ? (
                    <div
                        style={{
                            position: "absolute",
                            top: "calc(100% + 8px)",
                            bottom: "auto",
                            left: alignTooltipRight ? "auto" : 0,
                            right: alignTooltipRight ? 0 : "auto",
                            zIndex: 1600,
                            width: isMobile ? "min(248px, calc(100vw - 20px))" : "min(280px, calc(100vw - 40px))",
                            maxWidth: "calc(100vw - 24px)",
                            padding: isMobile ? "8px 9px" : "10px 11px",
                            borderRadius: UI_TOKENS.radius.sm,
                            border: "1px solid #cbd5e1",
                            background: "rgba(255,255,255,0.98)",
                            boxShadow: UI_TOKENS.shadow.raised,
                            color: "#334155",
                            fontSize: isMobile ? "0.74rem" : "0.78rem",
                            lineHeight: isMobile ? 1.35 : 1.45,
                        }}
                    >
                        {tooltipContent}
                    </div>
                ) : null}
            </button>
        );
    };

    const remainingKgLabel =
        impactStats.estimatedRemainingKg >= 1000
            ? `${(impactStats.estimatedRemainingKg / 1000).toFixed(2)} t`
            : `${Math.round(impactStats.estimatedRemainingKg)} kg`;
    const recoveredKgLabel =
        impactStats.estimatedRecoveredKg >= 1000
            ? `${(impactStats.estimatedRecoveredKg / 1000).toFixed(2)} t`
            : `${Math.round(impactStats.estimatedRecoveredKg)} kg`;
    const statTiles = [
        { id: "total-items", label: "Total Items", mobileLabel: "Total", valueNode: totals.total, tooltipContent: totalTooltipContent },
        { id: "historic-items", label: "Historic Finds", mobileLabel: "Historic", valueNode: totalHistoric, tooltipContent: historicTooltipContent, valueColor: "#92400e" },
        { id: "recovered-items", label: "Recovered", mobileLabel: "Recovered", valueNode: totals.recovered, tooltipContent: recoveredTooltipContent, valueColor: "green" },
        { id: "remaining-items", label: "Remaining", mobileLabel: "Remaining", valueNode: totals.remaining, tooltipContent: remainingTooltipContent, valueColor: "red" },
        { id: "locations", label: "Locations", mobileLabel: "Places", valueNode: locationCount, tooltipContent: locationsTooltipContent, valueColor: "#2c3e50" },
        { id: "remaining-weight", label: "Est. Weight Remaining", mobileLabel: "Weight Left", valueNode: remainingKgLabel, tooltipContent: remainingWeightTooltipContent, valueColor: "#b45309" },
        { id: "removed-weight", label: "Est. Weight Removed", mobileLabel: "Weight Out", valueNode: recoveredKgLabel, tooltipContent: removedWeightTooltipContent, valueColor: "#0f766e" },
    ];
    const activeStatTile = statTiles.find((tile) => tile.id === activeTooltip) || null;

    return (
        <div
            ref={statsRef}
            style={{
                display: "grid",
                gridTemplateColumns: isMobile
                    ? "repeat(2, minmax(0, 1fr))"
                    : "repeat(auto-fit, minmax(112px, 1fr))",
                gap: isMobile ? "5px" : "7px",
                marginTop: isMobile ? "1px" : "2px",
                fontSize: controlFontSize,
            }}
        >
                {statTiles.map((tile) => renderStatTile(
                    tile.id,
                    tile.label,
                    tile.valueNode,
                    tile.tooltipContent,
                    tile.valueColor,
                    tile.mobileLabel,
                ))}
                {isMobile && activeStatTile && typeof document !== "undefined"
                    ? createPortal(
                        <>
                            <div
                                onPointerDown={closeActiveTooltip}
                                onClick={closeActiveTooltip}
                                style={{
                                    position: "fixed",
                                    inset: 0,
                                    background: "rgba(15,23,42,0.18)",
                                    zIndex: 1690,
                                }}
                            />
                            <div
                                ref={mobileTooltipDialogRef}
                                role="dialog"
                                aria-modal="true"
                                aria-label={activeStatTile.label}
                                onPointerDown={stopTooltipEvent}
                                onClick={stopTooltipEvent}
                                style={{
                                    position: "fixed",
                                    left: "50%",
                                    top: "50%",
                                    transform: "translate(-50%, -50%)",
                                    zIndex: 1700,
                                    width: "min(320px, calc(100vw - 20px))",
                                    maxWidth: "calc(100vw - 20px)",
                                    maxHeight: "calc(100dvh - 24px)",
                                    overflowY: "auto",
                                    padding: "12px 12px 14px",
                                    borderRadius: "16px",
                                    border: "1px solid #cbd5e1",
                                    background: "rgba(255,255,255,0.99)",
                                    boxShadow: "0 24px 60px rgba(15,23,42,0.24)",
                                    color: "#334155",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "flex-start",
                                        justifyContent: "space-between",
                                        gap: "10px",
                                        marginBottom: "10px",
                                    }}
                                >
                                    <div>
                                        <div
                                            style={{
                                                fontSize: "0.7rem",
                                                fontWeight: 800,
                                                letterSpacing: "0.06em",
                                                textTransform: "uppercase",
                                                color: "#0369a1",
                                            }}
                                        >
                                            River stats
                                        </div>
                                        <div
                                            style={{
                                                marginTop: "3px",
                                                fontSize: "0.98rem",
                                                fontWeight: 800,
                                                lineHeight: 1.15,
                                                color: "#0f172a",
                                            }}
                                        >
                                            {activeStatTile.label}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onPointerDown={closeActiveTooltip}
                                        onClick={closeActiveTooltip}
                                        style={{
                                            border: "1px solid #cbd5e1",
                                            background: "#f8fafc",
                                            color: "#334155",
                                            borderRadius: "999px",
                                            minWidth: "30px",
                                            minHeight: "30px",
                                            fontSize: "0.92rem",
                                            fontWeight: 700,
                                            cursor: "pointer",
                                            flex: "0 0 auto",
                                        }}
                                        aria-label="Close stat details"
                                    >
                                        ×
                                    </button>
                                </div>
                                {activeStatTile.tooltipContent}
                            </div>
                        </>,
                        document.body,
                    )
                    : null}
        </div>
    );
}

function ControlToggles({
    isMobile,
    isTidePlannerCollapsed,
    hasHistoricOverlayAccess,
    isHistoricOverlayEnabled,
    isWeatherOverlayEnabled,
    isContributorsVisible,
    isHistoricalPoisVisible,
    historicOverlayLayers,
    selectedHistoricOverlayId,
    historicOverlayOpacityPercent,
    weatherOverlayUpdatedLabel,
    onToggleTidePlanner,
    onToggleHistoricOverlay,
    onHistoricOverlaySelect,
    onHistoricOverlayOpacityChange,
    onToggleWeatherOverlay,
    onToggleContributors,
    onToggleHistoricalPois,
}) {
    const selectedHistoricOverlay = historicOverlayLayers.find(
        (layer) => layer.id === selectedHistoricOverlayId,
    ) || historicOverlayLayers[0] || null;
    const controlsGap = isMobile ? "4px" : "6px";
    const controlButtonBaseStyle = {
        borderRadius: UI_TOKENS.radius.pill,
        padding: isMobile ? "5px 8px" : "5px 10px",
        minHeight: isMobile ? "28px" : "30px",
        width: "auto",
        fontSize: isMobile ? "0.76rem" : "0.8rem",
        fontWeight: 700,
        letterSpacing: "0.01em",
        lineHeight: 1.1,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isMobile ? "6px" : "8px",
        boxShadow: "0 4px 16px rgba(15,23,42,0.08)",
        whiteSpace: "nowrap",
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: isMobile ? "6px" : "10px",
                marginTop: 0,
                marginBottom: isTidePlannerCollapsed ? "2px" : "8px",
            }}
        >
            <div
                style={{
                    display: "flex",
                    alignItems: isMobile ? "stretch" : "center",
                    justifyContent: "space-between",
                    gap: controlsGap,
                    flexWrap: isMobile ? "nowrap" : "wrap",
                    flexDirection: isMobile ? "column" : "row",
                }}
            >
                <div
                    style={{
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        color: "#64748b",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                    }}
                >
                    Controls
                </div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: controlsGap,
                        flexWrap: isMobile ? "nowrap" : "wrap",
                        rowGap: controlsGap,
                        justifyContent: isMobile ? "flex-start" : "flex-end",
                        minWidth: 0,
                        overflowX: isMobile ? "auto" : "visible",
                        paddingBottom: isMobile ? "2px" : 0,
                    }}
                    className={isMobile ? "app-horizontal-chip-row" : undefined}
                >
                <button
                    onClick={onToggleTidePlanner}
                    style={{
                        ...controlButtonBaseStyle,
                        border: "1px solid #cbd5e1",
                        background: "linear-gradient(135deg, #eff6ff, #f8fafc)",
                        color: "#0f172a",
                        cursor: "pointer",
                        flex: "0 0 auto",
                    }}
                    aria-expanded={!isTidePlannerCollapsed}
                    aria-label={
                        isTidePlannerCollapsed
                            ? "Show cleanup planner"
                            : "Hide cleanup planner"
                    }
                >
                    <span>
                        Cleanup Planner
                    </span>
                    <span style={{ fontSize: "0.9em" }}>
                        {isTidePlannerCollapsed ? "▾" : "▴"}
                    </span>
                </button>

                <button
                    onClick={onToggleHistoricOverlay}
                    disabled={!hasHistoricOverlayAccess}
                    style={{
                        ...controlButtonBaseStyle,
                        border: isHistoricOverlayEnabled
                            ? "1px solid #4d7c0f"
                            : "1px solid #cbd5e1",
                        background: isHistoricOverlayEnabled
                            ? "linear-gradient(135deg, #ecfccb, #f7fee7)"
                            : "linear-gradient(135deg, #eff6ff, #f8fafc)",
                        color: isHistoricOverlayEnabled ? "#3f6212" : "#0f172a",
                        cursor: hasHistoricOverlayAccess ? "pointer" : "not-allowed",
                        opacity: hasHistoricOverlayAccess ? 1 : 0.55,
                        flex: "0 0 auto",
                    }}
                    aria-pressed={isHistoricOverlayEnabled}
                    aria-label={
                        hasHistoricOverlayAccess
                            ? (isHistoricOverlayEnabled
                                ? "Hide historic Lancaster maps"
                                : "Show historic Lancaster maps")
                            : "Historic maps are not available right now"
                    }
                    title={
                        hasHistoricOverlayAccess
                            ? "Toggle historic Lancaster maps"
                            : "Historic maps are not available right now"
                    }
                >
                    <span>
                        {hasHistoricOverlayAccess
                            ? (isHistoricOverlayEnabled ? "Historic Maps On" : "Historic Maps Off")
                            : "Historic Maps Unavailable"}
                    </span>
                </button>

                <button
                    onClick={onToggleHistoricalPois}
                    style={{
                        ...controlButtonBaseStyle,
                        border: isHistoricalPoisVisible
                            ? "1px solid #9a3412"
                            : "1px solid #fdba74",
                        background: isHistoricalPoisVisible
                            ? "linear-gradient(135deg, #ffedd5, #fff7ed)"
                            : "linear-gradient(135deg, #eff6ff, #f8fafc)",
                        color: isHistoricalPoisVisible ? "#9a3412" : "#0f172a",
                        cursor: "pointer",
                        flex: "0 0 auto",
                    }}
                    aria-pressed={isHistoricalPoisVisible}
                    aria-label={
                        isHistoricalPoisVisible
                            ? "Hide POIs"
                            : "Show POIs"
                    }
                >
                    <span>
                        {isHistoricalPoisVisible
                            ? "POIs On"
                            : "POIs Off"}
                    </span>
                </button>

                <button
                    onClick={onToggleWeatherOverlay}
                    style={{
                        ...controlButtonBaseStyle,
                        border: isWeatherOverlayEnabled
                            ? "1px solid #0f766e"
                            : "1px solid #cbd5e1",
                        background: isWeatherOverlayEnabled
                            ? "linear-gradient(135deg, #ccfbf1, #ecfeff)"
                            : "linear-gradient(135deg, #eff6ff, #f8fafc)",
                        color: isWeatherOverlayEnabled ? "#115e59" : "#0f172a",
                        padding: isMobile ? "5px 9px" : "6px 12px",
                        gap: isMobile ? "7px" : "10px",
                        cursor: "pointer",
                        flex: "0 0 auto",
                    }}
                    aria-pressed={isWeatherOverlayEnabled}
                    aria-label={
                        isWeatherOverlayEnabled
                            ? "Turn radar weather off"
                            : "Turn radar weather on"
                    }
                >
                    {/* Status dot */}
                    <span
                        aria-hidden="true"
                        style={{
                            width: "10px",
                            height: "10px",
                            borderRadius: "999px",
                            background: isWeatherOverlayEnabled
                                ? "#0ea5e9"
                                : "#cbd5e1",
                            boxShadow: isWeatherOverlayEnabled
                                ? "0 0 0 1px rgba(14,165,233,0.25)"
                                : "0 0 0 1px rgba(148,163,184,0.22)",
                            flexShrink: 0,
                        }}
                    />

                    {/* Label + status */}
                    <span>
                        {isWeatherOverlayEnabled
                            ? weatherOverlayUpdatedLabel
                                ? `Radar On · Updated ${weatherOverlayUpdatedLabel}`
                                : "Radar On · Live"
                            : "Radar Off"}
                    </span>
                </button>
                </div>
            </div>

            {hasHistoricOverlayAccess ? (
                isHistoricOverlayEnabled ? (
                <div
                    style={{
                        border: isHistoricOverlayEnabled
                            ? "1px solid #bef264"
                            : "1px solid #d9f99d",
                        background: isHistoricOverlayEnabled
                            ? "linear-gradient(145deg, #f7fee7 0%, #ffffff 100%)"
                            : "linear-gradient(145deg, #f8fafc 0%, #ffffff 100%)",
                        borderRadius: UI_TOKENS.radius.md,
                        padding: isMobile ? "10px 12px" : "10px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "10px",
                            flexWrap: "wrap",
                        }}
                    >
                        <div>
                            <div
                                style={{
                                    fontSize: "0.92rem",
                                    fontWeight: 700,
                                    color: "#365314",
                                }}
                            >
                                Lancaster Historic Overlay
                            </div>
                            <div
                                style={{
                                    fontSize: "0.8rem",
                                    color: "#4b5563",
                                    marginTop: "2px",
                                }}
                            >
                                {selectedHistoricOverlay?.description || "Compare today with older River Lune mapping."}
                            </div>
                            <div
                                style={{
                                    fontSize: "0.76rem",
                                    color: "#64748b",
                                    marginTop: "4px",
                                }}
                            >
                                Provider-backed NLS coverage currently starts at {EARLIEST_HISTORIC_OVERLAY_YEAR} for this Great Britain overlay set.
                            </div>
                        </div>
                        <div
                            style={{
                                fontSize: "0.79rem",
                                color: isHistoricOverlayEnabled ? "#3f6212" : "#64748b",
                                fontWeight: 700,
                            }}
                        >
                            {isHistoricOverlayEnabled ? "Overlay visible" : "Overlay hidden"}
                        </div>
                    </div>

                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1.4fr) minmax(200px, 1fr)",
                            gap: "12px",
                            alignItems: "end",
                        }}
                    >
                        <label
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                                minWidth: 0,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: "0.78rem",
                                    fontWeight: 700,
                                    color: "#475569",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                }}
                            >
                                Layer
                            </span>
                            <select
                                value={selectedHistoricOverlayId}
                                onChange={(event) => onHistoricOverlaySelect(event.target.value)}
                                style={{
                                    minHeight: "38px",
                                    borderRadius: "10px",
                                    border: "1px solid #cbd5e1",
                                    background: "#ffffff",
                                    color: "#0f172a",
                                    padding: "8px 10px",
                                    fontSize: "0.9rem",
                                }}
                            >
                                {historicOverlayLayers.map((layer) => (
                                    <option key={layer.id} value={layer.id}>
                                        {layer.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "6px",
                            }}
                        >
                            <span
                                style={{
                                    fontSize: "0.78rem",
                                    fontWeight: 700,
                                    color: "#475569",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                }}
                            >
                                Opacity {historicOverlayOpacityPercent}%
                            </span>
                            <input
                                type="range"
                                min="20"
                                max="100"
                                step="1"
                                value={historicOverlayOpacityPercent}
                                onChange={(event) => onHistoricOverlayOpacityChange(event.target.value)}
                                style={{
                                    width: "100%",
                                    accentColor: "#65a30d",
                                }}
                            />
                        </label>
                    </div>
                </div>
                ) : null
            ) : (
                <div
                    style={{
                        borderRadius: UI_TOKENS.radius.md,
                        border: "1px solid #e2e8f0",
                        background: "linear-gradient(145deg, #f8fafc 0%, #ffffff 100%)",
                        padding: isMobile ? "9px 10px" : "8px 12px",
                        color: "#475569",
                        fontSize: "0.82rem",
                        lineHeight: 1.45,
                    }}
                >
                    Historic overlays will appear here once a provider-backed or custom calibrated layer is available.
                </div>
            )}
        </div>
    );
}

function WeatherOverlayZoomGuard({ isWeatherOverlayEnabled }) {
    const map = useMap();
    const wasEnabledRef = useRef(false);
    const zoomBeforeRadarRef = useRef(null);

    useEffect(() => {
        if (!isWeatherOverlayEnabled) {
            if (wasEnabledRef.current && Number.isFinite(zoomBeforeRadarRef.current)) {
                const restoreZoom = zoomBeforeRadarRef.current;
                const currentZoom = map.getZoom();

                if (Math.abs(restoreZoom - currentZoom) >= 0.01) {
                    map.flyTo(map.getCenter(), restoreZoom, { duration: 0.65 });
                }
            }

            wasEnabledRef.current = false;
            zoomBeforeRadarRef.current = null;
            return;
        }

        const wasEnabled = wasEnabledRef.current;
        wasEnabledRef.current = true;
        if (wasEnabled) return;

        const currentZoom = map.getZoom();
        zoomBeforeRadarRef.current = currentZoom;
        const clampedZoom = Math.min(
            Math.max(currentZoom, RAINVIEWER_MIN_SUPPORTED_ZOOM),
            RAINVIEWER_MAX_SUPPORTED_ZOOM,
        );

        if (Math.abs(clampedZoom - currentZoom) < 0.01) return;

        map.flyTo(map.getCenter(), clampedZoom, { duration: 0.65 });
    }, [map, isWeatherOverlayEnabled]);

    return null;
}

function TransformedHistoricImageOverlay({
    imageUrl,
    corners,
    opacity = 1,
    attribution = "",
    onLoad,
    onError,
}) {
    const map = useMap();
    const imageRef = useRef(null);
    const sizeRef = useRef({ width: 0, height: 0 });

    useEffect(() => {
        const overlayPane = map.getPanes().overlayPane;
        if (!overlayPane || !imageUrl || !corners) return undefined;

        const image = document.createElement("img");
        imageRef.current = image;
        image.alt = "Historic map overlay";
        image.src = imageUrl;
        image.draggable = false;
        image.style.position = "absolute";
        image.style.left = "0";
        image.style.top = "0";
        image.style.transformOrigin = "0 0";
        image.style.pointerEvents = "none";
        image.style.userSelect = "none";
        image.style.zIndex = "410";
        image.style.maxWidth = "none";
        image.style.maxHeight = "none";
        image.style.opacity = String(opacity);
        overlayPane.appendChild(image);

        const updateTransform = () => {
            const { width, height } = sizeRef.current;
            if (!width || !height) return;

            const nextCorners = [corners.nw, corners.ne, corners.se, corners.sw]
                .map((corner) => normalizeHistoricOverlayCorner(corner));
            if (nextCorners.some((corner) => !corner)) return;

            const destinationPoints = nextCorners.map(([latitude, longitude]) =>
                map.latLngToLayerPoint([latitude, longitude]),
            );
            const transform = computeProjectiveMatrix3d(width, height, destinationPoints);
            if (!transform) return;

            image.style.width = `${width}px`;
            image.style.height = `${height}px`;
            image.style.transform = transform;
            image.style.opacity = String(opacity);
        };

        const handleLoad = () => {
            sizeRef.current = {
                width: image.naturalWidth,
                height: image.naturalHeight,
            };
            updateTransform();
            if (typeof onLoad === "function") onLoad();
        };

        const handleError = () => {
            if (typeof onError === "function") onError();
        };

        image.addEventListener("load", handleLoad);
        image.addEventListener("error", handleError);

        const refreshOverlay = () => {
            updateTransform();
        };

        map.on("zoom viewreset move resize", refreshOverlay);
        if (image.complete && image.naturalWidth > 0) {
            handleLoad();
        }

        return () => {
            map.off("zoom viewreset move resize", refreshOverlay);
            image.removeEventListener("load", handleLoad);
            image.removeEventListener("error", handleError);
            image.remove();
            imageRef.current = null;
        };
    }, [attribution, corners, imageUrl, map, onError, onLoad, opacity]);

    useEffect(() => {
        if (!attribution || !map.attributionControl) return undefined;

        map.attributionControl.addAttribution(attribution);
        return () => {
            map.attributionControl.removeAttribution(attribution);
        };
    }, [attribution, map]);

    return null;
}

function HistoricOverlayCornerHandles({ corners, onCornerChange, onMoveOverlay }) {
    const center = useMemo(() => getHistoricOverlayCornerCenter(corners), [corners]);
    if (!corners) return null;

    return (
        <>
            {[
                ["nw", corners.nw],
                ["ne", corners.ne],
                ["se", corners.se],
                ["sw", corners.sw],
            ].map(([key, position]) => {
                const normalizedPosition = normalizeHistoricOverlayCorner(position);
                if (!normalizedPosition) return null;

                return (
                    <Marker
                        key={key}
                        position={normalizedPosition}
                        draggable
                        icon={HISTORIC_OVERLAY_HANDLE_ICONS[key]}
                        eventHandlers={{
                            dragend: (event) => {
                                const nextLatLng = event.target.getLatLng();
                                onCornerChange(key, [nextLatLng.lat, nextLatLng.lng]);
                            },
                        }}
                    />
                );
            })}
            {center ? (
                <Marker
                    position={center}
                    draggable
                    icon={HISTORIC_OVERLAY_HANDLE_ICONS.center}
                    eventHandlers={{
                        dragstart: (event) => {
                            event.target.__historicOverlayStartLatLng = event.target.getLatLng();
                        },
                        dragend: (event) => {
                            const startLatLng = event.target.__historicOverlayStartLatLng;
                            const nextLatLng = event.target.getLatLng();
                            if (!startLatLng) return;

                            onMoveOverlay(
                                nextLatLng.lat - startLatLng.lat,
                                nextLatLng.lng - startLatLng.lng,
                            );
                        },
                    }}
                />
            ) : null}
        </>
    );
}

function FilterControls({
    isMobile,
    controlFontSize,
    typeFilter,
    statusFilter,
    isLuneStationsVisible,
    isRegionalFlowStationsVisible,
    isContributorsVisible,
    setIsLuneStationsVisible,
    setIsRegionalFlowStationsVisible,
    setIsContributorsVisible,
    setTypeFilter,
    setStatusFilter,
    isOverlay = false,
}) {
    const typeOptions = [
        { value: "all", label: "All" },
        { value: "bike", label: "Bike" },
        { value: "historic", label: "Historic finds" },
        { value: "motorbike", label: "Moto" },
        { value: "trolley", label: "Trolley" },
        { value: "misc", label: "Misc" },
    ];

    const statusOptions = [
        { value: "all", label: "All" },
        { value: "in-water", label: "In Water" },
        { value: "recovered", label: "Recovered" },
    ];

    const useSegmentedMobile = isMobile && !isOverlay;
    const useDesktopCompactLayout = !isMobile && !isOverlay;
    const useDesktopOverlayLayout = isOverlay && !isMobile;
    const [isOverlayCollapsed, setIsOverlayCollapsed] = useState(false);
    const showOverlayCollapseToggle = useDesktopOverlayLayout;
    const isOverlayContentHidden = showOverlayCollapseToggle && isOverlayCollapsed;
    const desktopCompactGroupStyle = useDesktopCompactLayout
        ? {
              border: "1px solid #dbe3ef",
              borderRadius: UI_TOKENS.radius.md,
              padding: "8px 10px",
              background: "linear-gradient(180deg, #f8fbff, #ffffff)",
              boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
          }
        : {};
    const desktopPillRowStyle = {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        flexWrap: "wrap",
    };
    const desktopPillButtonBaseStyle = {
        borderRadius: UI_TOKENS.radius.pill,
        padding: "5px 10px",
        fontSize: "0.8rem",
        minHeight: "30px",
        fontWeight: 700,
        cursor: "pointer",
        width: "auto",
        whiteSpace: "nowrap",
    };
    const overlayFieldGroupStyle = {};
    const overlayLabelStyle = useDesktopOverlayLayout
        ? {
              fontSize: "0.68rem",
              fontWeight: 700,
              color: "#334155",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
          }
        : {};
    const overlaySelectStyle = {};
    const overlayToggleButtonStyle = {};

    return (
        <div
            style={{
                ...(isOverlay
                    ? {
                          position: "absolute",
                          top: isMobile ? "8px" : "10px",
                          right: isMobile ? "8px" : "10px",
                          zIndex: 700,
                                                    maxWidth: isMobile ? "min(84vw, 240px)" : "240px",
                      }
                    : {}),
            }}
        >
            <div
                style={{
                    display: useDesktopCompactLayout ? "grid" : "flex",
                    gridTemplateColumns: useDesktopCompactLayout ? "repeat(2, minmax(190px, 1fr))" : "none",
                    flexWrap: isOverlay ? "nowrap" : isMobile ? "nowrap" : "wrap",
                    flexDirection: isOverlay ? "column" : isMobile ? "column" : "row",
                    gap: isOverlay ? "4px" : useDesktopCompactLayout ? "6px" : "8px",
                    marginBottom: isOverlay ? "0" : useDesktopCompactLayout ? "6px" : "8px",
                    marginTop: isOverlay ? "0" : useDesktopCompactLayout ? "6px" : "8px",
                    alignItems: isOverlay ? "stretch" : isMobile ? "stretch" : "center",
                    justifyItems: useDesktopCompactLayout ? "start" : "normal",
                    padding: isOverlay ? (isMobile ? "6px" : "6px") : "0",
                    borderRadius: isOverlay ? "8px" : "0",
                    border: isOverlay ? "1px solid #cbd5e1" : "none",
                    background: isOverlay ? "rgba(255,255,255,0.98)" : "transparent",
                    boxShadow: isOverlay ? "0 4px 12px rgba(15,23,42,0.1)" : "none",
                }}
            >
                {isOverlay ? (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "6px",
                            marginBottom: useDesktopOverlayLayout ? "2px" : "1px",
                        }}
                    >
                        <span
                            style={{
                                fontSize: "0.68rem",
                                fontWeight: 700,
                                color: "#475569",
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                            }}
                        >
                            Filters
                        </span>
                        {showOverlayCollapseToggle ? (
                            <button
                                type="button"
                                onClick={() => setIsOverlayCollapsed((prev) => !prev)}
                                aria-expanded={!isOverlayCollapsed}
                                aria-label={isOverlayCollapsed ? "Expand filters" : "Collapse filters"}
                                title={isOverlayCollapsed ? "Expand filters" : "Collapse filters"}
                                style={{
                                    width: "18px",
                                    height: "18px",
                                    borderRadius: "6px",
                                    border: "1px solid #cbd5e1",
                                    background: "#f8fafc",
                                    color: "#334155",
                                    fontSize: "0.8rem",
                                    lineHeight: 1,
                                    fontWeight: 700,
                                    padding: 0,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                }}
                            >
                                {isOverlayCollapsed ? "+" : "-"}
                            </button>
                        ) : null}
                    </div>
                ) : null}

                {!isOverlayContentHidden && (useSegmentedMobile ? (
                    <>
                        <div style={{ display: "grid", gap: "6px" }}>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.04em" }}>Type</span>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                {typeOptions.map((option) => (
                                    <button
                                        key={`type-${option.value}`}
                                        type="button"
                                        onClick={() => setTypeFilter(option.value)}
                                        style={{
                                            border: typeFilter === option.value ? "1px solid #2563eb" : "1px solid #cbd5e1",
                                            background: typeFilter === option.value ? "#dbeafe" : "#fff",
                                            color: "#0f172a",
                                            borderRadius: UI_TOKENS.radius.pill,
                                            padding: "7px 10px",
                                            fontSize: "0.8rem",
                                            fontWeight: 700,
                                            minHeight: "34px",
                                        }}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: "grid", gap: "6px" }}>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#334155", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</span>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                {statusOptions.map((option) => (
                                    <button
                                        key={`status-${option.value}`}
                                        type="button"
                                        onClick={() => setStatusFilter(option.value)}
                                        style={{
                                            border: statusFilter === option.value ? "1px solid #2563eb" : "1px solid #cbd5e1",
                                            background: statusFilter === option.value ? "#dbeafe" : "#fff",
                                            color: "#0f172a",
                                            borderRadius: UI_TOKENS.radius.pill,
                                            padding: "7px 10px",
                                            fontSize: "0.8rem",
                                            fontWeight: 700,
                                            minHeight: "34px",
                                        }}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div style={{ display: "grid", gap: "6px" }}>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#0f766e", textTransform: "uppercase", letterSpacing: "0.04em" }}>Sensors</span>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                <button
                                    type="button"
                                    onClick={() => setIsLuneStationsVisible((prev) => !prev)}
                                    style={{
                                        border: isLuneStationsVisible ? "1px solid #0f766e" : "1px solid #99f6e4",
                                        background: isLuneStationsVisible ? "#ccfbf1" : "#f8fafc",
                                        color: isLuneStationsVisible ? "#115e59" : "#475569",
                                        borderRadius: UI_TOKENS.radius.pill,
                                        padding: "7px 10px",
                                        fontSize: "0.8rem",
                                        fontWeight: 700,
                                        minHeight: "34px",
                                    }}
                                    aria-pressed={isLuneStationsVisible}
                                >
                                    {isLuneStationsVisible ? "Sensor Stations On" : "Sensor Stations Off"}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setIsRegionalFlowStationsVisible((prev) => !prev)}
                                    style={{
                                        border: isRegionalFlowStationsVisible ? "1px solid #0369a1" : "1px solid #bae6fd",
                                        background: isRegionalFlowStationsVisible ? "#e0f2fe" : "#f8fafc",
                                        color: isRegionalFlowStationsVisible ? "#0c4a6e" : "#475569",
                                        borderRadius: UI_TOKENS.radius.pill,
                                        padding: "7px 10px",
                                        fontSize: "0.8rem",
                                        fontWeight: 700,
                                        minHeight: "34px",
                                    }}
                                    aria-pressed={isRegionalFlowStationsVisible}
                                >
                                    {isRegionalFlowStationsVisible ? "Regional Filters On" : "Regional Filters Off"}
                                </button>
                            </div>
                        </div>

                        <div style={{ display: "grid", gap: "6px" }}>
                            <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#854d0e", textTransform: "uppercase", letterSpacing: "0.04em" }}>Contributors</span>
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                <button
                                    type="button"
                                    onClick={() => setIsContributorsVisible((prev) => !prev)}
                                    style={{
                                        border: isContributorsVisible ? "1px solid #ca8a04" : "1px solid #fcd34d",
                                        background: isContributorsVisible ? "#fef3c7" : "#f8fafc",
                                        color: isContributorsVisible ? "#854d0e" : "#475569",
                                        borderRadius: UI_TOKENS.radius.pill,
                                        padding: "7px 10px",
                                        fontSize: "0.8rem",
                                        fontWeight: 700,
                                        minHeight: "34px",
                                    }}
                                    aria-pressed={isContributorsVisible}
                                >
                                    {isContributorsVisible ? "Contributors On" : "Contributors Off"}
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: isOverlay ? "2px" : "6px",
                                flexDirection: isOverlay ? "column" : "row",
                                ...desktopCompactGroupStyle,
                                ...overlayFieldGroupStyle,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: isOverlay ? "0.72rem" : controlFontSize,
                                    fontWeight: 600,
                                    alignSelf: isOverlay ? "flex-start" : "auto",
                                    ...overlayLabelStyle,
                                }}
                            >
                                Type
                            </span>
                            <select
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value)}
                                style={{
                                    border: isOverlay ? "1px solid #9ca3af" : "1px solid #cbd5e1",
                                    borderRadius: isOverlay ? "4px" : "8px",
                                    padding: isOverlay ? "5px 6px" : isMobile ? "9px 10px" : "5px 8px",
                                    fontSize: isOverlay ? "0.78rem" : controlFontSize,
                                    background: "#fff",
                                    minHeight: isOverlay ? "28px" : isMobile ? "40px" : "32px",
                                    width: isOverlay ? "100%" : isMobile ? "100%" : "auto",
                                    ...overlaySelectStyle,
                                }}
                            >
                                <option value="all">All</option>
                                <option value="bike">Bikes</option>
                                <option value="historic">Historic finds</option>
                                <option value="motorbike">Motorbikes</option>
                                <option value="trolley">Trolleys</option>
                                <option value="misc">Misc</option>
                            </select>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: isOverlay ? "2px" : "6px",
                                flexDirection: isOverlay ? "column" : "row",
                                ...desktopCompactGroupStyle,
                                ...overlayFieldGroupStyle,
                            }}
                        >
                            <span
                                style={{
                                    fontSize: isOverlay ? "0.72rem" : controlFontSize,
                                    fontWeight: 600,
                                    alignSelf: isOverlay ? "flex-start" : "auto",
                                    ...overlayLabelStyle,
                                }}
                            >
                                Status
                            </span>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                style={{
                                    border: isOverlay ? "1px solid #9ca3af" : "1px solid #cbd5e1",
                                    borderRadius: isOverlay ? "4px" : "8px",
                                    padding: isOverlay ? "5px 6px" : isMobile ? "9px 10px" : "5px 8px",
                                    fontSize: isOverlay ? "0.78rem" : controlFontSize,
                                    background: "#fff",
                                    minHeight: isOverlay ? "28px" : isMobile ? "40px" : "32px",
                                    width: isOverlay ? "100%" : isMobile ? "100%" : "auto",
                                    ...overlaySelectStyle,
                                }}
                            >
                                <option value="all">All</option>
                                <option value="in-water">In Water</option>
                                <option value="recovered">Recovered</option>
                            </select>
                        </div>

                        {useDesktopCompactLayout ? (
                            <div
                                style={{
                                    gridColumn: "1 / -1",
                                    ...desktopCompactGroupStyle,
                                }}
                            >
                                <div style={desktopPillRowStyle}>
                                    <button
                                        type="button"
                                        onClick={() => setIsLuneStationsVisible((prev) => !prev)}
                                        style={{
                                            ...desktopPillButtonBaseStyle,
                                            border: isLuneStationsVisible ? "1px solid #0f766e" : "1px solid #99f6e4",
                                            background: isLuneStationsVisible
                                                ? "linear-gradient(135deg, #ccfbf1, #ecfeff)"
                                                : "linear-gradient(135deg, #f8fafc, #ffffff)",
                                            color: isLuneStationsVisible ? "#115e59" : "#475569",
                                        }}
                                        aria-pressed={isLuneStationsVisible}
                                        aria-label={isLuneStationsVisible ? "Hide sensor stations" : "Show sensor stations"}
                                    >
                                        {isLuneStationsVisible ? "Sensor Stations: On" : "Sensor Stations: Off"}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setIsRegionalFlowStationsVisible((prev) => !prev)}
                                        style={{
                                            ...desktopPillButtonBaseStyle,
                                            border: isRegionalFlowStationsVisible ? "1px solid #0369a1" : "1px solid #bae6fd",
                                            background: isRegionalFlowStationsVisible
                                                ? "linear-gradient(135deg, #e0f2fe, #f0f9ff)"
                                                : "linear-gradient(135deg, #f8fafc, #ffffff)",
                                            color: isRegionalFlowStationsVisible ? "#0c4a6e" : "#475569",
                                        }}
                                        aria-pressed={isRegionalFlowStationsVisible}
                                        aria-label={isRegionalFlowStationsVisible ? "Hide regional stations" : "Show regional stations"}
                                    >
                                        {isRegionalFlowStationsVisible ? "Regional Stations: On" : "Regional Stations: Off"}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => setIsContributorsVisible((prev) => !prev)}
                                        style={{
                                            ...desktopPillButtonBaseStyle,
                                            border: isContributorsVisible ? "1px solid #ca8a04" : "1px solid #fcd34d",
                                            background: isContributorsVisible
                                                ? "linear-gradient(135deg, #fef3c7, #fffbeb)"
                                                : "linear-gradient(135deg, #f8fafc, #ffffff)",
                                            color: isContributorsVisible ? "#854d0e" : "#475569",
                                        }}
                                        aria-pressed={isContributorsVisible}
                                        aria-label={isContributorsVisible ? "Hide contributors" : "Show contributors"}
                                    >
                                        {isContributorsVisible ? "Contributors: On" : "Contributors: Off"}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setIsLuneStationsVisible((prev) => !prev)}
                                    style={{
                                        border: isLuneStationsVisible ? "1px solid #0f766e" : "1px solid #99f6e4",
                                        borderRadius: isOverlay ? "4px" : UI_TOKENS.radius.pill,
                                        padding: isOverlay ? "5px 6px" : isMobile ? "9px 10px" : "5px 10px",
                                        fontSize: isOverlay ? "0.78rem" : controlFontSize,
                                        background: isLuneStationsVisible
                                            ? "linear-gradient(135deg, #ccfbf1, #ecfeff)"
                                            : "linear-gradient(135deg, #f8fafc, #ffffff)",
                                        color: isLuneStationsVisible ? "#115e59" : "#475569",
                                        minHeight: isOverlay ? "28px" : isMobile ? "40px" : "32px",
                                        width: isOverlay ? "100%" : isMobile ? "100%" : "auto",
                                        fontWeight: 700,
                                        cursor: "pointer",
                                        ...overlayToggleButtonStyle,
                                    }}
                                    aria-pressed={isLuneStationsVisible}
                                    aria-label={isLuneStationsVisible ? "Hide sensor stations" : "Show sensor stations"}
                                >
                                    {isLuneStationsVisible ? "Sensor Stations: On" : "Sensor Stations: Off"}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setIsRegionalFlowStationsVisible((prev) => !prev)}
                                    style={{
                                        border: isRegionalFlowStationsVisible ? "1px solid #0369a1" : "1px solid #bae6fd",
                                        borderRadius: isOverlay ? "4px" : UI_TOKENS.radius.pill,
                                        padding: isOverlay ? "5px 6px" : isMobile ? "9px 10px" : "5px 10px",
                                        fontSize: isOverlay ? "0.78rem" : controlFontSize,
                                        background: isRegionalFlowStationsVisible
                                            ? "linear-gradient(135deg, #e0f2fe, #f0f9ff)"
                                            : "linear-gradient(135deg, #f8fafc, #ffffff)",
                                        color: isRegionalFlowStationsVisible ? "#0c4a6e" : "#475569",
                                        minHeight: isOverlay ? "28px" : isMobile ? "40px" : "32px",
                                        width: isOverlay ? "100%" : isMobile ? "100%" : "auto",
                                        fontWeight: 700,
                                        cursor: "pointer",
                                        ...overlayToggleButtonStyle,
                                    }}
                                    aria-pressed={isRegionalFlowStationsVisible}
                                    aria-label={isRegionalFlowStationsVisible ? "Hide regional stations" : "Show regional stations"}
                                >
                                    {isRegionalFlowStationsVisible ? "Regional Stations: On" : "Regional Stations: Off"}
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setIsContributorsVisible((prev) => !prev)}
                                    style={{
                                        border: isContributorsVisible ? "1px solid #ca8a04" : "1px solid #fcd34d",
                                        borderRadius: isOverlay ? "4px" : UI_TOKENS.radius.pill,
                                        padding: isOverlay ? "5px 6px" : isMobile ? "9px 10px" : "5px 10px",
                                        fontSize: isOverlay ? "0.78rem" : controlFontSize,
                                        background: isContributorsVisible
                                            ? "linear-gradient(135deg, #fef3c7, #fffbeb)"
                                            : "linear-gradient(135deg, #f8fafc, #ffffff)",
                                        color: isContributorsVisible ? "#854d0e" : "#475569",
                                        minHeight: isOverlay ? "28px" : isMobile ? "40px" : "32px",
                                        width: isOverlay ? "100%" : isMobile ? "100%" : "auto",
                                        fontWeight: 700,
                                        cursor: "pointer",
                                        ...overlayToggleButtonStyle,
                                    }}
                                    aria-pressed={isContributorsVisible}
                                    aria-label={isContributorsVisible ? "Hide contributors" : "Show contributors"}
                                >
                                    {isContributorsVisible ? "Contributors: On" : "Contributors: Off"}
                                </button>
                            </>
                        )}
                    </>
                ))}
            </div>
        </div>
    );
}

function MapStatusBanner({ isLoadingItems, totalItemCount, filteredItemCount, isMobile }) {
    let message = "";

    if (isLoadingItems) {
        message = "Loading cleanup locations...";
    } else if (totalItemCount === 0) {
        message = "No cleanup locations yet. Tap the map to add the first one.";
    } else if (filteredItemCount === 0) {
        message = "No locations match the current filters.";
    }

    if (!message) return null;

    return (
        <div
            style={{
                marginBottom: "8px",
                padding: isMobile ? "9px 10px" : "8px 10px",
                borderRadius: "10px",
                border: "1px solid #dbeafe",
                background: "#f8fbff",
                color: "#334155",
                fontSize: "0.82rem",
                lineHeight: 1.4,
            }}
        >
            {message}
        </div>
    );
}

function TidePlanner({
    isTidePlannerCollapsed,
    isMobile,
    isLoadingLancasterTides,
    fetchLancasterTides,
    lancasterTideUpdatedAt,
    lancasterTideError,
    tideChartData,
}) {
    const [selectedTideIndex, setSelectedTideIndex] = useState(null);
    const [liveTideTimeMs, setLiveTideTimeMs] = useState(() => Date.now());
    const [activeCleanupWindowIndex, setActiveCleanupWindowIndex] = useState(null);
    const tideChartViewportRef = useRef(null);

    useEffect(() => {
        if (isTidePlannerCollapsed || !tideChartData?.points?.length) return undefined;

        setLiveTideTimeMs(Date.now());

        const intervalId = window.setInterval(() => {
            setLiveTideTimeMs(Date.now());
        }, 15000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [isTidePlannerCollapsed, tideChartData]);

    const currentTideTime = useMemo(() => new Date(liveTideTimeMs), [liveTideTimeMs]);
    const currentTideMarker = useMemo(
        () => buildCurrentTideMarker(tideChartData, liveTideTimeMs),
        [tideChartData, liveTideTimeMs],
    );
    const nextTide = useMemo(
        () =>
            tideChartData?.points?.find((point) => point.date.getTime() >= liveTideTimeMs) || null,
        [tideChartData, liveTideTimeMs],
    );
    const previousTide = useMemo(
        () =>
            tideChartData?.points
                ? [...tideChartData.points].reverse().find((point) => point.date.getTime() <= liveTideTimeMs) || null
                : null,
        [tideChartData, liveTideTimeMs],
    );

    useEffect(() => {
        if (!tideChartData?.points?.length) {
            setSelectedTideIndex(null);
            return;
        }

        if (selectedTideIndex !== null) {
            const selectedStillExists = tideChartData.points.some((point) => point.index === selectedTideIndex);
            if (selectedStillExists) return;
        }

        const fallbackPoint = nextTide || tideChartData.points[0];
        setSelectedTideIndex(fallbackPoint?.index ?? null);
    }, [nextTide, tideChartData, selectedTideIndex]);

    useEffect(() => {
        if (!tideChartData?.cleanupWindows?.length) {
            setActiveCleanupWindowIndex(null);
            return;
        }

        const activeWindowStillExists = tideChartData.cleanupWindows.some(
            (window) => window.index === activeCleanupWindowIndex,
        );

        if (!activeWindowStillExists) {
            setActiveCleanupWindowIndex(null);
        }
    }, [activeCleanupWindowIndex, tideChartData]);

    useEffect(() => {
        if (!isMobile || activeCleanupWindowIndex === null) return undefined;

        const handlePointerDown = (event) => {
            if (tideChartViewportRef.current?.contains(event.target)) return;
            setActiveCleanupWindowIndex(null);
        };

        window.addEventListener("pointerdown", handlePointerDown);

        return () => {
            window.removeEventListener("pointerdown", handlePointerDown);
        };
    }, [activeCleanupWindowIndex, isMobile]);

    const selectedTidePoint =
        tideChartData?.points?.find((point) => point.index === selectedTideIndex) ||
        nextTide ||
        tideChartData?.points?.[0] ||
        null;
    const activeCleanupWindow =
        tideChartData?.cleanupWindows?.find((window) => window.index === activeCleanupWindowIndex) ||
        null;
    const activeCleanupWindowPosition = activeCleanupWindow
        ? activeCleanupWindow.lowTideX / tideChartData.width
        : null;
    const cleanupTooltipPlacement =
        activeCleanupWindowPosition === null
            ? "center"
            : activeCleanupWindowPosition < 0.24
              ? "left"
              : activeCleanupWindowPosition > 0.76
                ? "right"
                : "center";
    const cleanupTooltipStartLabel = activeCleanupWindow
        ? formatTideTime(new Date(activeCleanupWindow.startTime))
        : "";
    const cleanupTooltipEndLabel = activeCleanupWindow
        ? formatTideTime(new Date(activeCleanupWindow.endTime))
        : "";

    return (
        <div
            style={{
                marginBottom: isTidePlannerCollapsed ? "0px" : "8px",
                marginTop: isTidePlannerCollapsed ? "0px" : "6px",
                transition: "margin 220ms ease",
            }}
        >
            <div
                style={{
                    maxHeight: isTidePlannerCollapsed ? "0px" : "1200px",
                    opacity: isTidePlannerCollapsed ? 0 : 1,
                    transform: isTidePlannerCollapsed ? "translateY(-4px)" : "translateY(0)",
                    overflow: isTidePlannerCollapsed ? "hidden" : "visible",
                    pointerEvents: isTidePlannerCollapsed ? "none" : "auto",
                    transition:
                        "max-height 260ms ease, opacity 180ms ease, transform 220ms ease",
                }}
            >
                <div
                    style={{
                        padding: isMobile ? "9px" : "9px 11px",
                        border: "1px solid #dbe3ee",
                        borderRadius: "12px",
                        background: "linear-gradient(160deg, #f8fbff 0%, #f2f7ff 62%, #f8fafc 100%)",
                        boxShadow: "0 8px 20px rgba(15,23,42,0.06)",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "6px",
                            flexWrap: "wrap",
                            marginBottom: "7px",
                        }}
                    >
                        <div style={{ fontSize: "0.86rem", fontWeight: 700, color: "#1e293b" }}>
                            Lancaster, UK
                        </div>
                        <button
                            onClick={fetchLancasterTides}
                            disabled={isLoadingLancasterTides}
                            style={{
                                border: "1px solid #cbd5e1",
                                borderRadius: "999px",
                                padding: "5px 11px",
                                background: "#fff",
                                fontSize: "0.8rem",
                                minHeight: "32px",
                                fontWeight: 700,
                                cursor: isLoadingLancasterTides ? "wait" : "pointer",
                                opacity: 1,
                            }}
                            title="Reload saved Lancaster tide times"
                        >
                            {isLoadingLancasterTides ? "Refreshing..." : "Refresh"}
                        </button>
                    </div>

                    <div
                        style={{
                            marginBottom: "7px",
                            padding: isMobile ? "9px 10px" : "10px 12px",
                            borderRadius: "12px",
                            border: "1px solid #dbeafe",
                            background: "linear-gradient(180deg, rgba(239,246,255,0.95) 0%, rgba(248,250,252,0.98) 100%)",
                            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.7)",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                gap: "6px",
                                flexWrap: "wrap",
                                alignItems: "center",
                                marginBottom: "5px",
                            }}
                        >
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    borderRadius: "999px",
                                    background: "#dbeafe",
                                    color: "#1d4ed8",
                                    padding: "3px 8px",
                                    fontSize: "0.69rem",
                                    fontWeight: 800,
                                    letterSpacing: "0.04em",
                                    textTransform: "uppercase",
                                }}
                            >
                                Tide guidance
                            </span>
                            <span
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    borderRadius: "999px",
                                    background: "#fef2f2",
                                    color: "#b91c1c",
                                    padding: "3px 8px",
                                    fontSize: "0.69rem",
                                    fontWeight: 800,
                                    letterSpacing: "0.04em",
                                    textTransform: "uppercase",
                                }}
                            >
                                Safety warning
                            </span>
                        </div>

                        <div style={{ fontSize: "0.81rem", color: "#1e293b", lineHeight: 1.45, fontWeight: 600 }}>
                            The best cleanup window is usually around low tide. Aim for roughly 2 hours before and 2 hours after the low tide dips shown on the graph.
                        </div>

                        <div style={{ fontSize: "0.77rem", color: "#475569", lineHeight: 1.45, marginTop: "4px" }}>
                            These windows are estimates only and conditions can change quickly.
                        </div>

                        <div
                            style={{
                                marginTop: "7px",
                                padding: "8px 10px",
                                borderRadius: "10px",
                                border: "1px solid #fecaca",
                                background: "linear-gradient(180deg, #fff5f5 0%, #fef2f2 100%)",
                            }}
                        >
                            <div
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    borderRadius: "999px",
                                    background: "#fee2e2",
                                    color: "#991b1b",
                                    padding: "2px 7px",
                                    fontSize: "0.67rem",
                                    fontWeight: 800,
                                    letterSpacing: "0.05em",
                                    textTransform: "uppercase",
                                    marginBottom: "4px",
                                }}
                            >
                                Highest risk
                            </div>
                            <div style={{ fontSize: "0.78rem", color: "#7f1d1d", lineHeight: 1.45, fontWeight: 800 }}>
                                Outgoing tides are particularly dangerous.
                            </div>
                            <div style={{ fontSize: "0.76rem", color: "#7f1d1d", lineHeight: 1.45, marginTop: "2px", fontWeight: 700 }}>
                                Tides are dangerous at all times. Do not enter the water without strict professional supervision.
                            </div>
                        </div>
                    </div>

                    {lancasterTideUpdatedAt ? (
                        <div style={{ fontSize: "0.74rem", color: "#64748b", marginBottom: "6px" }}>
                            Updated: {new Date(lancasterTideUpdatedAt).toLocaleString()}
                        </div>
                    ) : null}

                    {lancasterTideError ? (
                        <div
                            style={{
                                marginBottom: "6px",
                                padding: "8px 10px",
                                borderRadius: "8px",
                                background: "#fff7ed",
                                color: "#9a3412",
                                border: "1px solid #fdba74",
                                fontSize: "0.83rem",
                            }}
                        >
                            {lancasterTideError}
                        </div>
                    ) : null}

                    {isLoadingLancasterTides && !tideChartData && !lancasterTideError ? (
                        <div
                            style={{
                                marginBottom: "8px",
                                padding: "10px 12px",
                                borderRadius: "10px",
                                border: "1px solid #dbeafe",
                                background: "rgba(255,255,255,0.86)",
                                color: "#475569",
                                fontSize: "0.83rem",
                            }}
                        >
                            Loading saved Lancaster tide data...
                        </div>
                    ) : null}

                    {tideChartData ? (
                        <div
                            style={{
                                border: "1px solid #e2e8f0",
                                borderRadius: "12px",
                                background: "#ffffff",
                                marginBottom: "6px",
                                padding: isMobile ? "8px" : "8px 10px",
                            }}
                        >
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                <div
                                    style={{
                                        display: "flex",
                                        gap: "6px",
                                        flexWrap: "wrap",
                                        fontSize: "0.75rem",
                                        color: "#475569",
                                    }}
                                >
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                        <span aria-hidden="true" style={{ width: "10px", height: "10px", borderRadius: "999px", background: "#1d4ed8" }} />
                                        Tide curve
                                    </span>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                        <span
                                            aria-hidden="true"
                                            style={{
                                                width: "14px",
                                                height: "10px",
                                                borderRadius: "4px",
                                                background: "rgba(22,163,74,0.2)",
                                                border: "1px solid rgba(22,163,74,0.55)",
                                            }}
                                        />
                                        2 hr cleanup window
                                    </span>
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                        <span aria-hidden="true" style={{ width: "2px", height: "14px", background: "#dc2626" }} />
                                        Current time
                                    </span>
                                </div>

                                <div
                                    ref={tideChartViewportRef}
                                    style={{ width: "100%", overflowX: "auto", marginTop: "-3px", marginBottom: "-2px" }}
                                >
                                    <div
                                        style={{
                                            position: "relative",
                                            width: `max(100%, ${tideChartData.width}px)`,
                                            minWidth: `${tideChartData.width}px`,
                                        }}
                                    >
                                        {activeCleanupWindow ? (
                                            <div
                                                role="status"
                                                aria-live="polite"
                                                style={{
                                                    position: "absolute",
                                                    top: "10px",
                                                    left:
                                                        cleanupTooltipPlacement === "left"
                                                            ? "10px"
                                                            : cleanupTooltipPlacement === "center"
                                                              ? `${(activeCleanupWindow.lowTideX / tideChartData.width) * 100}%`
                                                              : "auto",
                                                    right: cleanupTooltipPlacement === "right" ? "10px" : "auto",
                                                    transform:
                                                        cleanupTooltipPlacement === "center"
                                                            ? "translateX(-50%)"
                                                            : "none",
                                                    width: isMobile ? "min(260px, calc(100% - 20px))" : "min(300px, calc(100% - 20px))",
                                                    padding: "10px 12px",
                                                    borderRadius: "12px",
                                                    border: "1px solid rgba(15, 23, 42, 0.12)",
                                                    background: "rgba(255, 255, 255, 0.96)",
                                                    color: "#0f172a",
                                                    boxShadow: "0 14px 28px rgba(15,23,42,0.16)",
                                                    fontSize: "0.76rem",
                                                    lineHeight: 1.45,
                                                    zIndex: 2,
                                                    pointerEvents: "none",
                                                }}
                                            >
                                                <div style={{ fontWeight: 800, color: "#166534", marginBottom: "3px" }}>
                                                    Estimated 2 hour cleanup window
                                                </div>
                                                <div style={{ color: "#334155" }}>
                                                    Around {cleanupTooltipStartLabel} to {cleanupTooltipEndLabel}.
                                                </div>
                                                <div style={{ color: "#7f1d1d", marginTop: "5px", fontWeight: 700 }}>
                                                    Estimated only. Tides are dangerous at all times, and outgoing tides are particularly dangerous. Do not enter the water without strict professional supervision.
                                                </div>
                                            </div>
                                        ) : null}

                                        <svg
                                            viewBox={`0 0 ${tideChartData.width} ${tideChartData.height}`}
                                            role="img"
                                            aria-label="Wave graph of upcoming Lancaster tide highs, lows, and current time"
                                            style={{ width: "100%", height: "auto", display: "block" }}
                                        >
                                        <defs>
                                            <linearGradient id="tideBackdropGradient" x1="0" x2="0" y1="0" y2="1">
                                                <stop offset="0%" stopColor="#f8fbff" />
                                                <stop offset="100%" stopColor="#eef6ff" />
                                            </linearGradient>
                                            <linearGradient id="tideAreaGradient" x1="0" x2="0" y1="0" y2="1">
                                                <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.45" />
                                                <stop offset="100%" stopColor="#dbeafe" stopOpacity="0.12" />
                                            </linearGradient>
                                            <filter id="tideCurveGlow" x="-10%" y="-20%" width="120%" height="140%">
                                                <feGaussianBlur stdDeviation="6" result="blur" />
                                                <feColorMatrix
                                                    in="blur"
                                                    type="matrix"
                                                    values="0 0 0 0 0.145 0 0 0 0 0.388 0 0 0 0 0.922 0 0 0 0.18 0"
                                                />
                                            </filter>
                                        </defs>

                                        <rect
                                            x={tideChartData.padding.left}
                                            y={tideChartData.padding.top}
                                            width={tideChartData.width - tideChartData.padding.left - tideChartData.padding.right}
                                            height={tideChartData.baselineY - tideChartData.padding.top}
                                            rx="18"
                                            fill="url(#tideBackdropGradient)"
                                        />

                                        {[0.25, 0.5, 0.75].map((ratio) => {
                                            const y = tideChartData.padding.top + (tideChartData.baselineY - tideChartData.padding.top) * ratio;

                                            return (
                                                <line
                                                    key={`h-grid-${ratio}`}
                                                    x1={tideChartData.padding.left}
                                                    x2={tideChartData.width - tideChartData.padding.right}
                                                    y1={y}
                                                    y2={y}
                                                    stroke="#dbeafe"
                                                    strokeWidth="1"
                                                    strokeDasharray="4 6"
                                                />
                                            );
                                        })}

                                        <line
                                            x1={tideChartData.padding.left}
                                            x2={tideChartData.width - tideChartData.padding.right}
                                            y1={tideChartData.medianY}
                                            y2={tideChartData.medianY}
                                            stroke="#94a3b8"
                                            strokeWidth="1.5"
                                            strokeDasharray="8 8"
                                            opacity="0.8"
                                        />

                                        <line
                                            x1={tideChartData.padding.left}
                                            x2={tideChartData.width - tideChartData.padding.right}
                                            y1={tideChartData.baselineY}
                                            y2={tideChartData.baselineY}
                                            stroke="#cbd5e1"
                                            strokeWidth="1"
                                        />

                                        {tideChartData.cleanupWindows.map((window) => {
                                            const isActive = activeCleanupWindowIndex === window.index;
                                            const cleanupWindowSummary = `Estimated cleanup window from ${formatTideTime(new Date(window.startTime))} to ${formatTideTime(new Date(window.endTime))}. Tides are dangerous at all times, and outgoing tides are particularly dangerous. Do not enter the water without strict professional supervision.`;

                                            return (
                                            <g
                                                key={`cleanup-window-${window.index}`}
                                                role="button"
                                                tabIndex={0}
                                                aria-label={cleanupWindowSummary}
                                                onMouseEnter={() => {
                                                    if (!isMobile) setActiveCleanupWindowIndex(window.index);
                                                }}
                                                onMouseLeave={() => {
                                                    if (!isMobile) {
                                                        setActiveCleanupWindowIndex((currentIndex) =>
                                                            currentIndex === window.index ? null : currentIndex,
                                                        );
                                                    }
                                                }}
                                                onFocus={() => setActiveCleanupWindowIndex(window.index)}
                                                onBlur={() => {
                                                    setActiveCleanupWindowIndex((currentIndex) =>
                                                        currentIndex === window.index ? null : currentIndex,
                                                    );
                                                }}
                                                onClick={() => {
                                                    if (isMobile) {
                                                        setActiveCleanupWindowIndex((currentIndex) =>
                                                            currentIndex === window.index ? null : window.index,
                                                        );
                                                    }
                                                }}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter" || event.key === " ") {
                                                        event.preventDefault();
                                                        setActiveCleanupWindowIndex((currentIndex) =>
                                                            currentIndex === window.index ? null : window.index,
                                                        );
                                                    }

                                                    if (event.key === "Escape") {
                                                        setActiveCleanupWindowIndex(null);
                                                    }
                                                }}
                                                style={{ cursor: "pointer" }}
                                            >
                                                <rect
                                                    x={window.xStart}
                                                    y={tideChartData.padding.top}
                                                    width={Math.max(window.xEnd - window.xStart, 1)}
                                                    height={tideChartData.baselineY - tideChartData.padding.top}
                                                    rx="12"
                                                    fill={isActive ? "rgba(22, 163, 74, 0.22)" : "rgba(22, 163, 74, 0.11)"}
                                                />
                                                <line
                                                    x1={window.xStart}
                                                    x2={window.xStart}
                                                    y1={tideChartData.padding.top}
                                                    y2={tideChartData.baselineY}
                                                    stroke={isActive ? "rgba(21, 128, 61, 0.95)" : "rgba(22, 163, 74, 0.6)"}
                                                    strokeWidth={isActive ? "1.4" : "1"}
                                                    strokeDasharray="5 5"
                                                />
                                                <line
                                                    x1={window.xEnd}
                                                    x2={window.xEnd}
                                                    y1={tideChartData.padding.top}
                                                    y2={tideChartData.baselineY}
                                                    stroke={isActive ? "rgba(21, 128, 61, 0.95)" : "rgba(22, 163, 74, 0.6)"}
                                                    strokeWidth={isActive ? "1.4" : "1"}
                                                    strokeDasharray="5 5"
                                                />
                                            </g>
                                            );
                                        })}

                                        {tideChartData.points.map((point) => (
                                            <line
                                                key={`grid-${point.index}`}
                                                x1={point.x}
                                                x2={point.x}
                                                y1={tideChartData.padding.top}
                                                y2={tideChartData.baselineY}
                                                stroke="#e2e8f0"
                                                strokeDasharray="4 6"
                                                strokeWidth="1"
                                            />
                                        ))}

                                        <path d={tideChartData.areaPath} fill="url(#tideAreaGradient)" />
                                        <path
                                            d={tideChartData.curvePath}
                                            fill="none"
                                            stroke="#60a5fa"
                                            strokeWidth="7"
                                            strokeLinecap="round"
                                            opacity="0.1"
                                            filter="url(#tideCurveGlow)"
                                        />
                                        <path
                                            d={tideChartData.curvePath}
                                            fill="none"
                                            stroke="#2563eb"
                                            strokeWidth="2.5"
                                            strokeLinecap="round"
                                        />

                                        {currentTideMarker ? (
                                            <g>
                                                {(() => {
                                                    const timeLabelX = Math.min(
                                                        Math.max(currentTideMarker.x + 8, tideChartData.padding.left + 24),
                                                        tideChartData.width - tideChartData.padding.right - 24,
                                                    );

                                                    return (
                                                        <>
                                                <line
                                                    x1={currentTideMarker.x}
                                                    x2={currentTideMarker.x}
                                                    y1={tideChartData.padding.top}
                                                    y2={tideChartData.baselineY}
                                                    stroke="#dc2626"
                                                    strokeWidth="1.5"
                                                    strokeDasharray="6 4"
                                                    opacity="0.8"
                                                />
                                                <rect
                                                    x={timeLabelX - 19}
                                                    y={tideChartData.padding.top + 5}
                                                    width="38"
                                                    height="14"
                                                    rx="7"
                                                    fill="#fff5f5"
                                                    stroke="#dc2626"
                                                    strokeWidth="1"
                                                    opacity="0.95"
                                                />
                                                <text
                                                    x={timeLabelX}
                                                    y={tideChartData.padding.top + 12.8}
                                                    textAnchor="middle"
                                                    dominantBaseline="middle"
                                                    fontSize="8"
                                                    fontWeight="700"
                                                    fill="#b91c1c"
                                                >
                                                    {formatTideClockTime(currentTideMarker.time)}
                                                </text>
                                                <circle
                                                    cx={currentTideMarker.x}
                                                    cy={currentTideMarker.y}
                                                    r="3.2"
                                                    fill="#ffffff"
                                                    stroke="#dc2626"
                                                    strokeWidth="1.8"
                                                />
                                                        </>
                                                    );
                                                })()}
                                            </g>
                                        ) : null}

                                        {tideChartData.points.map((point) => {
                                            const rawTimeY = point.isLowTide ? point.y + 13 : point.y - 8;
                                            const timeY = Math.max(rawTimeY, tideChartData.padding.top + 9);
                                            const dateLabelX = Math.min(
                                                Math.max(point.x, tideChartData.padding.left + 22),
                                                tideChartData.width - tideChartData.padding.right - 22,
                                            );
                                            const isSelected = point.index === selectedTidePoint?.index;

                                            return (
                                                <g
                                                    key={`point-${point.index}`}
                                                    role="button"
                                                    tabIndex={0}
                                                    aria-label={`Select ${point.type} at ${formatTideTime(point.date)}`}
                                                    onClick={() => setSelectedTideIndex(point.index)}
                                                    onKeyDown={(event) => {
                                                        if (event.key === "Enter" || event.key === " ") {
                                                            event.preventDefault();
                                                            setSelectedTideIndex(point.index);
                                                        }
                                                    }}
                                                    style={{ cursor: "pointer" }}
                                                >
                                                    <circle cx={point.x} cy={point.y} r={isSelected ? "8" : "7"} fill={point.isLowTide ? "#16a34a" : "#2563eb"} opacity={isSelected ? "0.3" : "0.16"} />
                                                    <circle cx={point.x} cy={point.y} r={isSelected ? "5.3" : "4.4"} fill={point.isLowTide ? "#16a34a" : "#1d4ed8"} stroke={isSelected ? "#0f172a" : "#ffffff"} strokeWidth={isSelected ? "2" : "2.5"} />
                                                    <text x={dateLabelX} y={timeY} textAnchor="middle" fontSize="8.8" fill="#64748b">
                                                        {formatTideTime(point.date).replace(/^[A-Za-z]{3},?\s*/, "")}
                                                    </text>
                                                    <text x={dateLabelX} y={tideChartData.height - 4} textAnchor="middle" fontSize="9.2" fontWeight="700" fill="#475569">
                                                        {formatTideDay(point.date)}
                                                    </text>
                                                </g>
                                            );
                                        })}
                                        </svg>
                                    </div>
                                </div>

                                <div
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))",
                                        gap: "6px",
                                    }}
                                >
                                    <div style={{ borderRadius: "10px", border: "1px solid #dbeafe", background: "#eff6ff", padding: "8px 10px" }}>
                                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>Previous tide</div>
                                        <div style={{ marginTop: "4px", fontSize: "0.88rem", fontWeight: 700, color: "#0f172a" }}>
                                            {previousTide ? previousTide.type : "Unavailable"}
                                        </div>
                                        <div style={{ marginTop: "2px", fontSize: "0.78rem", color: "#475569" }}>
                                            {previousTide ? `${formatTideTime(previousTide.date)} • ${previousTide.height.toFixed(2)} m` : "No tide before current time in this range."}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            borderRadius: "10px",
                                            border: selectedTidePoint?.isLowTide ? "1px solid #86efac" : "1px solid #bfdbfe",
                                            background: selectedTidePoint?.isLowTide ? "#f0fdf4" : "#eff6ff",
                                            padding: "8px 10px",
                                        }}
                                    >
                                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: selectedTidePoint?.isLowTide ? "#15803d" : "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>Selected tide</div>
                                        <div style={{ marginTop: "4px", fontSize: "0.88rem", fontWeight: 700, color: "#0f172a" }}>
                                            {selectedTidePoint ? selectedTidePoint.type : "Unavailable"}
                                        </div>
                                        <div style={{ marginTop: "2px", fontSize: "0.78rem", color: "#475569" }}>
                                            {selectedTidePoint
                                                ? `${formatTideTime(selectedTidePoint.date)} • ${selectedTidePoint.height.toFixed(2)} m`
                                                : "Tap a tide point on the graph for details."}
                                        </div>
                                    </div>

                                    <div style={{ borderRadius: "10px", border: "1px solid #fecaca", background: "#fef2f2", padding: "8px 10px" }}>
                                        <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.04em" }}>Current time</div>
                                        <div style={{ marginTop: "4px", fontSize: "0.88rem", fontWeight: 700, color: "#0f172a" }}>
                                            {formatTideTime(currentTideMarker?.time || currentTideTime)}
                                        </div>
                                        <div style={{ marginTop: "2px", fontSize: "0.78rem", color: "#475569" }}>
                                            {currentTideMarker ? `Estimated height ${currentTideMarker.height.toFixed(2)} m between ${currentTideMarker.previous.type} and ${currentTideMarker.next.type}.` : "Current time sits outside the saved chart range."}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ marginTop: "2px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                    {tideChartData.points.map((point) => {
                                        const isSelected = point.index === selectedTidePoint?.index;

                                        return (
                                            <button
                                                key={`tide-chip-${point.index}`}
                                                onClick={() => setSelectedTideIndex(point.index)}
                                                style={{
                                                    border: isSelected ? "1px solid #1d4ed8" : "1px solid #cbd5e1",
                                                    background: isSelected ? "#dbeafe" : "#fff",
                                                    color: "#0f172a",
                                                    borderRadius: "999px",
                                                    padding: "4px 9px",
                                                    fontSize: "0.74rem",
                                                    fontWeight: 700,
                                                    cursor: "pointer",
                                                }}
                                            >
                                                {formatTideTime(point.date).replace(/^[A-Za-z]{3},?\s*/, "")}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {!isLoadingLancasterTides && !tideChartData && !lancasterTideError ? (
                        <div
                            style={{
                                marginBottom: "8px",
                                padding: "10px 12px",
                                borderRadius: "10px",
                                border: "1px dashed #bfdbfe",
                                background: "rgba(255,255,255,0.75)",
                                color: "#475569",
                                fontSize: "0.83rem",
                            }}
                        >
                            No saved tide snapshot is available right now. Try refreshing to load the latest Lancaster data.
                        </div>
                    ) : null}

                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <a
                            href={LANCASTER_TIDE_CHART_URL}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                                textDecoration: "none",
                                border: "1px solid #93c5fd",
                                color: "#1d4ed8",
                                background: "#fff",
                                borderRadius: "999px",
                                padding: isMobile ? "9px 12px" : "7px 11px",
                                fontSize: "0.8rem",
                                fontWeight: 700,
                            }}
                        >
                            Open Full Lancaster Chart
                        </a>
                    </div>
                </div>
            </div>
        </div>
    );
}

function FullscreenImageViewer({
    isOpen,
    isMobile,
    selectedItem,
    selectedCounts,
    selectedStory,
    selectedGps,
    selectedGeoLookup,
    isResolvingGeoLookup,
    selectedMapsUrl,
    onClose,
}) {
    const MIN_ZOOM = 1;
    const MAX_ZOOM = 3;
    const ZOOM_STEP = 0.25;
    const [zoomLevel, setZoomLevel] = useState(1);
    const [isDetailsVisible, setIsDetailsVisible] = useState(true);
    const [activeImageIndex, setActiveImageIndex] = useState(0);
    const swipeTouchStartX = useRef(null);

    useEffect(() => {
        if (!isOpen) return;
        setZoomLevel(1);
        setIsDetailsVisible(true);
        setActiveImageIndex(0);
    }, [isOpen, selectedItem?.id]);

    if (!isOpen || !selectedItem?.image_url || !selectedCounts) return null;

    const clampZoom = (value) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    const zoomPercent = Math.round(zoomLevel * 100);
    const hasReferenceImage = Boolean(selectedStory?.referenceImageUrl);
    const images = [
        { url: selectedItem.image_url, label: null },
        ...(hasReferenceImage ? [{ url: selectedStory.referenceImageUrl, label: "Reference Image", sourceLink: selectedStory.referenceImageCaption }] : []),
    ];
    const activeImage = images[activeImageIndex] ?? images[0];
    const canGoPrev = activeImageIndex > 0;
    const canGoNext = activeImageIndex < images.length - 1;

    const handleTouchStart = (e) => {
        if (zoomLevel > 1) { swipeTouchStartX.current = null; return; }
        swipeTouchStartX.current = e.touches[0].clientX;
    };
    const handleTouchEnd = (e) => {
        if (swipeTouchStartX.current === null || images.length < 2) return;
        const delta = e.changedTouches[0].clientX - swipeTouchStartX.current;
        swipeTouchStartX.current = null;
        if (Math.abs(delta) < 50) return;
        if (delta < 0) {
            // swipe left → next (wrap around)
            setActiveImageIndex((i) => (i + 1) % images.length);
        } else {
            // swipe right → prev (wrap around)
            setActiveImageIndex((i) => (i - 1 + images.length) % images.length);
        }
        setZoomLevel(1);
    };
    const timeInRiverLabel = formatTimeInRiver(
        selectedStory?.knownSinceDate,
        selectedStory?.recoveredOnDate,
    );

    const viewerNode = (
        <div
            style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0, 0, 0, 0.92)",
                zIndex: 2100,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: isMobile ? "8px" : "20px",
                boxSizing: "border-box",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    top: "10px",
                    left: "10px",
                    display: "flex",
                    gap: "8px",
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: "999px",
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: "rgba(0,0,0,0.42)",
                    color: "#fff",
                    zIndex: 2,
                }}
            >
                <button
                    type="button"
                    onClick={() => setZoomLevel((prev) => clampZoom(prev - ZOOM_STEP))}
                    disabled={zoomLevel <= MIN_ZOOM}
                    style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        border: "1px solid rgba(255,255,255,0.35)",
                        background: "rgba(15,23,42,0.5)",
                        color: "#fff",
                        fontSize: "1.1rem",
                        cursor: "pointer",
                        opacity: zoomLevel <= MIN_ZOOM ? 0.45 : 1,
                    }}
                    aria-label="Zoom out"
                >
                    -
                </button>

                <input
                    type="range"
                    min={MIN_ZOOM}
                    max={MAX_ZOOM}
                    step={ZOOM_STEP}
                    value={zoomLevel}
                    onChange={(event) => setZoomLevel(Number(event.target.value))}
                    aria-label="Zoom level"
                />

                <button
                    type="button"
                    onClick={() => setZoomLevel((prev) => clampZoom(prev + ZOOM_STEP))}
                    disabled={zoomLevel >= MAX_ZOOM}
                    style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "50%",
                        border: "1px solid rgba(255,255,255,0.35)",
                        background: "rgba(15,23,42,0.5)",
                        color: "#fff",
                        fontSize: "1.1rem",
                        cursor: "pointer",
                        opacity: zoomLevel >= MAX_ZOOM ? 0.45 : 1,
                    }}
                    aria-label="Zoom in"
                >
                    +
                </button>

                <button
                    type="button"
                    onClick={() => setZoomLevel(1)}
                    style={{
                        borderRadius: "999px",
                        border: "1px solid rgba(255,255,255,0.35)",
                        background: "rgba(15,23,42,0.45)",
                        color: "#fff",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        padding: "6px 9px",
                        cursor: "pointer",
                    }}
                    aria-label="Reset zoom"
                >
                    {zoomPercent}%
                </button>

                <button
                    type="button"
                    onClick={() => setIsDetailsVisible((prev) => !prev)}
                    style={{
                        borderRadius: "999px",
                        border: "1px solid rgba(255,255,255,0.35)",
                        background: "rgba(15,23,42,0.45)",
                        color: "#fff",
                        fontSize: "0.78rem",
                        fontWeight: 700,
                        padding: "6px 10px",
                        cursor: "pointer",
                    }}
                    aria-label={isDetailsVisible ? "Hide details panel" : "Show details panel"}
                >
                    {isDetailsVisible ? "Hide Details" : "Show Details"}
                </button>
            </div>

            <button
                onClick={onClose}
                style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
                    zIndex: 3,
                    width: "40px",
                    height: "40px",
                    borderRadius: "50%",
                    border: "1px solid rgba(255,255,255,0.4)",
                    background: "rgba(0,0,0,0.4)",
                    color: "#fff",
                    fontSize: "1.3rem",
                    cursor: "pointer",
                }}
                aria-label="Close fullscreen image"
            >
                ×
            </button>

            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    overflow: "auto",
                    display: "grid",
                    alignItems: "start",
                    justifyItems: "center",
                    touchAction: zoomLevel > 1 ? "pan-x pan-y pinch-zoom" : "pan-y pinch-zoom",
                    padding: isMobile ? "58px 8px 8px" : "64px 20px 20px",
                    paddingBottom: isDetailsVisible ? (isMobile ? "150px" : "172px") : (isMobile ? "12px" : "20px"),
                    boxSizing: "border-box",
                }}
                onTouchStart={images.length > 1 ? handleTouchStart : undefined}
                onTouchEnd={images.length > 1 ? handleTouchEnd : undefined}
            >
                <div
                    style={{
                        width: "100%",
                        display: "grid",
                        gap: "10px",
                        justifyItems: "center",
                    }}
                >
                    {activeImage.label ? (
                        <div
                            style={{
                                color: "rgba(226,232,240,0.9)",
                                fontSize: "0.76rem",
                                fontWeight: 700,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                background: "rgba(15,23,42,0.65)",
                                padding: "4px 12px",
                                borderRadius: "999px",
                                border: "1px solid rgba(148,163,184,0.3)",
                            }}
                        >
                            {activeImage.label}
                        </div>
                    ) : null}

                    <img
                        src={activeImage.url}
                        alt={activeImage.label ?? "Debris evidence full size"}
                        style={{
                            width: `${zoomPercent}%`,
                            height: "auto",
                        }}
                    />

                    {activeImage.sourceLink ? (
                        <a
                            href={activeImage.sourceLink}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#93c5fd", fontWeight: 700, fontSize: "0.82rem", textDecoration: "underline" }}
                        >
                            Open Street View source
                        </a>
                    ) : null}
                </div>
            </div>

            {images.length > 1 ? (
                <div
                    style={{
                        position: "absolute",
                        left: "50%",
                        transform: "translateX(-50%)",
                        bottom: isDetailsVisible ? (isMobile ? "154px" : "178px") : "14px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        zIndex: 2,
                    }}
                >
                    <button
                        type="button"
                        onClick={() => { setActiveImageIndex((i) => i - 1); setZoomLevel(1); }}
                        disabled={!canGoPrev}
                        style={{
                            width: "34px",
                            height: "34px",
                            borderRadius: "50%",
                            border: "1px solid rgba(255,255,255,0.35)",
                            background: "rgba(15,23,42,0.6)",
                            color: "#fff",
                            fontSize: "1rem",
                            cursor: canGoPrev ? "pointer" : "default",
                            opacity: canGoPrev ? 1 : 0.35,
                        }}
                        aria-label="Previous image"
                    >
                        ‹
                    </button>
                    {images.map((_, idx) => (
                        <button
                            key={idx}
                            type="button"
                            onClick={() => { setActiveImageIndex(idx); setZoomLevel(1); }}
                            style={{
                                width: idx === activeImageIndex ? "10px" : "8px",
                                height: idx === activeImageIndex ? "10px" : "8px",
                                borderRadius: "50%",
                                border: "none",
                                background: idx === activeImageIndex ? "#f8fafc" : "rgba(248,250,252,0.35)",
                                cursor: "pointer",
                                padding: 0,
                                transition: "all 0.15s",
                            }}
                            aria-label={`View image ${idx + 1}`}
                        />
                    ))}
                    <button
                        type="button"
                        onClick={() => { setActiveImageIndex((i) => i + 1); setZoomLevel(1); }}
                        disabled={!canGoNext}
                        style={{
                            width: "34px",
                            height: "34px",
                            borderRadius: "50%",
                            border: "1px solid rgba(255,255,255,0.35)",
                            background: "rgba(15,23,42,0.6)",
                            color: "#fff",
                            fontSize: "1rem",
                            cursor: canGoNext ? "pointer" : "default",
                            opacity: canGoNext ? 1 : 0.35,
                        }}
                        aria-label="Next image"
                    >
                        ›
                    </button>
                </div>
            ) : null}

            {isDetailsVisible ? (
                <div
                    style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: "linear-gradient(to top, rgba(0, 0, 0, 0.95), rgba(0, 0, 0, 0.6))",
                        color: "#f8fafc",
                        padding: "10px 14px 14px",
                        fontSize: "0.85rem",
                        lineHeight: 1.45,
                    }}
                >
                    <div style={{ display: "grid", gap: "8px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", color: "#ffffff" }}>
                            <strong style={{ fontSize: "0.96rem" }}>{TYPE_LABELS[normalizeType(selectedItem.type)]}</strong>
                            <span style={{ color: "rgba(226,232,240,0.82)" }}>•</span>
                            <span style={{ color: "rgba(241,245,249,0.92)" }}>
                                {selectedCounts.isRecovered ? "Recovered" : "In Water"}
                            </span>
                        </div>

                        <div style={{ color: "rgba(226,232,240,0.86)" }}>
                            Spotted: {new Date(selectedItem.created_at).toLocaleString()}
                        </div>

                        {selectedStory?.knownSinceDate ? (
                            <div style={{ color: "rgba(226,232,240,0.86)" }}>
                                Known in river since: {formatStoryDate(selectedStory.knownSinceDate)}
                            </div>
                        ) : null}

                        {selectedStory?.recoveredOnDate ? (
                            <div style={{ color: "rgba(226,232,240,0.86)" }}>
                                Recovered on: {formatStoryDate(selectedStory.recoveredOnDate)}
                                {timeInRiverLabel ? ` (${timeInRiverLabel} in river)` : ""}
                            </div>
                        ) : null}

                        <LocationDetailsBlock
                            gps={selectedGps}
                            geoLookup={selectedGeoLookup}
                            isResolving={isResolvingGeoLookup}
                            mapsUrl={selectedMapsUrl}
                            mapPoint={{ latitude: selectedItem.y, longitude: selectedItem.x }}
                            compact
                            inverted
                            w3wAddress={selectedItem.w3w_address ?? null}
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );

    return createPortal(viewerNode, document.body);
}

function SelectedItemDrawer({
    selectedItem,
    selectedCounts,
    selectedStory,
    selectedGps,
    selectedGeoLookup,
    isResolvingGeoLookup,
    selectedMapsUrl,
    selectedWeight,
    editingItemId,
    editForm,
    isUpdatingItemId,
    isMobile,
    setSelectedItemId,
    setEditingItemId,
    setEditForm,
    setIsImageViewerOpen,
    saveItemEdits,
    removeLocation,
    startEditingItem,
    canManageItems,
    onUploadReferenceImage,
    isUploadingReferenceImage,
    onCopyShareLink,
    copiedShareItemId,
    shareCopyStatus,
}) {
    if (!selectedItem || !selectedCounts) return null;
    const useCompactLayout =
        isMobile || (typeof window !== "undefined" && window.innerWidth <= 1024);
    const useBottomSheet = isMobile;
    const isEditingThisItem = canManageItems && editingItemId === selectedItem.id;
    const compactNoScroll = false;
    const statGridColumns = useCompactLayout ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))";
    const imagePanelHeight = useCompactLayout ? "min(23svh, 180px)" : "208px";
    const selectedItemType = normalizeType(selectedItem.type);
    const itemTypeLabel = TYPE_LABELS[selectedItemType];
    const itemStatusLabel = selectedCounts.isRecovered ? "Recovered" : "In Water";
    const shareButtonLabel = copiedShareItemId === selectedItem.id && shareCopyStatus ? "Copied" : "Share";
    const useDenseDesktopCard = !useBottomSheet && !isEditingThisItem;
    const timeInRiverLabel = formatTimeInRiver(
        selectedStory?.knownSinceDate,
        selectedStory?.recoveredOnDate,
    );
    const itemTypeBadgeLabel = selectedItemType === "historic" ? "Historic find" : "Cleanup item";
    const itemTypeBadgeStyles = selectedItemType === "historic"
        ? {
            background: "#fffbeb",
            border: "1px solid #fcd34d",
            color: "#92400e",
            dotColor: selectedCounts.isRecovered ? "#22c55e" : "#b45309",
            dotShadow: selectedCounts.isRecovered
                ? "0 0 0 4px rgba(34,197,94,0.14)"
                : "0 0 0 4px rgba(180,83,9,0.18)",
            icon: "🏺",
        }
        : {
            background: "#eff6ff",
            border: "1px solid #dbeafe",
            color: "#1d4ed8",
            dotColor: selectedCounts.isRecovered ? "#22c55e" : "#f59e0b",
            dotShadow: selectedCounts.isRecovered
                ? "0 0 0 4px rgba(34,197,94,0.14)"
                : "0 0 0 4px rgba(245,158,11,0.14)",
            icon: "•",
        };

    const drawerNode = (
        <>
            <div
                onClick={() => {
                    setSelectedItemId(null);
                    setEditingItemId(null);
                }}
                style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(2, 6, 23, 0.45)",
                    zIndex: 1499,
                }}
            />

            <div
                data-drawer-version={useBottomSheet ? "v5-bottom-sheet" : "v5-desktop-card"}
                style={{
                    position: "fixed",
                    ...(useBottomSheet ? {
                        left: "8px",
                        right: "8px",
                        bottom: "max(8px, env(safe-area-inset-bottom, 0px))",
                        top: "max(10px, env(safe-area-inset-top, 0px) + 8px)",
                        width: "auto",
                        maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 18px)",
                        borderRadius: "22px",
                    } : {
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        width: "min(700px, calc(100vw - 48px))",
                        maxHeight: isEditingThisItem ? "min(90vh, 800px)" : "min(88vh, 760px)",
                        borderRadius: "18px",
                    }),
                    overflowY: compactNoScroll ? "hidden" : useBottomSheet || isEditingThisItem ? "auto" : "hidden",
                    background: "#ffffff",
                    boxShadow: "0 24px 60px rgba(0,0,0,0.32)",
                    zIndex: 1500,
                    padding: useBottomSheet
                        ? "10px 10px calc(env(safe-area-inset-bottom, 0px) + 10px)"
                        : useDenseDesktopCard ? "10px" : "12px",
                    boxSizing: "border-box",
                    display: "flex",
                    flexDirection: "column",
                    border: "1px solid rgba(219, 227, 238, 0.95)",
                }}
            >
                {useBottomSheet ? (
                    <div
                        aria-hidden="true"
                        style={{
                            width: "42px",
                            height: "5px",
                            borderRadius: "999px",
                            background: "#d7dee8",
                            margin: "0 auto 10px",
                            flexShrink: 0,
                        }}
                    />
                ) : null}

                <div
                    style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: "12px",
                        marginBottom: compactNoScroll ? "6px" : useBottomSheet ? "10px" : useDenseDesktopCard ? "6px" : "8px",
                        padding: useBottomSheet ? "2px 2px 8px" : "2px 2px 8px",
                        borderBottom: "1px solid rgba(226,232,240,0.92)",
                    }}
                >
                    <div style={{ minWidth: 0, display: "grid", gap: "4px" }}>
                        <div
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "6px",
                                width: "fit-content",
                                padding: "4px 9px",
                                borderRadius: "999px",
                                background: itemTypeBadgeStyles.background,
                                border: itemTypeBadgeStyles.border,
                                color: itemTypeBadgeStyles.color,
                                fontSize: "0.68rem",
                                fontWeight: 700,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                            }}
                        >
                            <span aria-hidden="true" style={{ fontSize: "0.85rem", lineHeight: 1 }}>
                                {itemTypeBadgeStyles.icon}
                            </span>
                            <span
                                aria-hidden="true"
                                style={{
                                    width: "7px",
                                    height: "7px",
                                    borderRadius: "999px",
                                    background: itemTypeBadgeStyles.dotColor,
                                    boxShadow: itemTypeBadgeStyles.dotShadow,
                                }}
                            />
                            {itemTypeBadgeLabel}
                        </div>
                        <strong
                            style={{
                                fontSize: useBottomSheet ? "1.12rem" : "1.22rem",
                                lineHeight: 1.1,
                                color: "#0f172a",
                            }}
                        >
                            {itemTypeLabel} recovery log
                        </strong>
                        <div
                            style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "8px",
                                alignItems: "center",
                                color: "#64748b",
                                fontSize: useDenseDesktopCard ? "0.77rem" : "0.8rem",
                            }}
                        >
                            <span>{new Date(selectedItem.created_at).toLocaleDateString()}</span>
                            <span aria-hidden="true" style={{ color: "#cbd5e1" }}>•</span>
                            <span style={{ color: "#334155", fontWeight: 600 }}>{itemStatusLabel}</span>
                        </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                        {onCopyShareLink ? (
                            <button
                                onClick={() => onCopyShareLink(selectedItem.id)}
                                style={{
                                    border: "1px solid #bfdbfe",
                                    background: copiedShareItemId === selectedItem.id && shareCopyStatus
                                        ? "linear-gradient(135deg, #dcfce7 0%, #bbf7d0 100%)"
                                        : "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
                                    color: copiedShareItemId === selectedItem.id && shareCopyStatus ? "#166534" : "#1d4ed8",
                                    borderRadius: "999px",
                                    height: "34px",
                                    padding: "0 14px",
                                    fontWeight: 700,
                                    fontSize: "0.84rem",
                                    letterSpacing: "0.01em",
                                    cursor: "pointer",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "7px",
                                    boxShadow: copiedShareItemId === selectedItem.id && shareCopyStatus
                                        ? "0 10px 18px rgba(34,197,94,0.18)"
                                        : "0 10px 18px rgba(37,99,235,0.14)",
                                    transition: "transform 160ms ease, box-shadow 160ms ease",
                                }}
                            >
                                <span aria-hidden="true" style={{ fontSize: "0.95rem", transform: "translateY(-0.5px)" }}>
                                    {copiedShareItemId === selectedItem.id && shareCopyStatus ? "✓" : "↗"}
                                </span>
                                {shareButtonLabel}
                            </button>
                        ) : null}
                        <button
                            onClick={() => {
                                setSelectedItemId(null);
                                setEditingItemId(null);
                            }}
                            style={{
                                border: "1px solid #dbe3ee",
                                background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                                borderRadius: "999px",
                                width: "34px",
                                height: "34px",
                                fontWeight: 700,
                                cursor: "pointer",
                                color: "#475569",
                                boxShadow: "0 6px 14px rgba(15,23,42,0.08)",
                                transition: "transform 160ms ease, box-shadow 160ms ease",
                            }}
                            aria-label="Close details"
                        >
                            ×
                        </button>
                    </div>
                </div>

                {/* Two-column on desktop, stacked on mobile */}
                <div style={{
                    display: compactNoScroll ? "flex" : useCompactLayout ? "block" : "flex",
                    gap: compactNoScroll ? "10px" : useBottomSheet ? "14px" : useDenseDesktopCard ? "10px" : "12px",
                    alignItems: "flex-start",
                    flex: compactNoScroll ? 1 : "0 0 auto",
                    minHeight: 0,
                }}>
                    {/* Left: image */}
                    <div style={{
                        flexShrink: 0,
                        width: compactNoScroll ? "42%" : useCompactLayout ? "100%" : "240px",
                        marginBottom: compactNoScroll ? 0 : useCompactLayout ? "8px" : useDenseDesktopCard ? "0" : "0",
                    }}>
                        {selectedItem.image_url ? (
                            <button
                                onClick={() => setIsImageViewerOpen(true)}
                                style={{
                                    border: "1px solid #dbe3ee",
                                    background: "linear-gradient(180deg, #f8fbff 0%, #f1f5f9 100%)",
                                    width: "100%",
                                    padding: useBottomSheet ? "8px" : useDenseDesktopCard ? "8px" : "10px",
                                    cursor: "zoom-in",
                                    display: "block",
                                    borderRadius: useBottomSheet ? "18px" : "16px",
                                    boxShadow: "0 10px 24px rgba(15,23,42,0.08)",
                                }}
                            >
                                <div
                                    style={{
                                        width: "100%",
                                        height: imagePanelHeight,
                                        borderRadius: useBottomSheet ? "14px" : "12px",
                                        background: "rgba(255,255,255,0.9)",
                                        border: "1px solid rgba(203,213,225,0.9)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        overflow: "hidden",
                                    }}
                                >
                                    <img
                                        src={getStorageThumbnailUrl(selectedItem.image_url, 600, 75)}
                                        alt="Debris evidence"
                                        loading="lazy"
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            objectFit: "contain",
                                            display: "block",
                                        }}
                                    />
                                </div>
                                {useBottomSheet ? (
                                    <div
                                        style={{
                                            marginTop: "6px",
                                            fontSize: "0.74rem",
                                            color: "#64748b",
                                            textAlign: "left",
                                        }}
                                    >
                                        Full image shown. Tap to expand.
                                    </div>
                                ) : null}
                            </button>
                        ) : (
                            <div style={{
                                padding: "10px",
                                color: "#999",
                                fontSize: "0.8rem",
                                fontStyle: "italic",
                                border: "1px dashed #cbd5e1",
                                borderRadius: useBottomSheet ? "18px" : "12px",
                                height: useCompactLayout ? "140px" : "220px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            }}>
                                No photo attached
                            </div>
                        )}

                        {!isItemStoryEmpty(selectedStory) ? (
                            <div
                                style={{
                                    display: "grid",
                                    gap: "5px",
                                    marginTop: "8px",
                                    padding: compactNoScroll ? "8px 9px" : useBottomSheet ? "8px 9px" : "10px 11px",
                                    borderRadius: "12px",
                                    border: "1px solid #dbe3ee",
                                    background: "#f8fafc",
                                    color: "#334155",
                                    fontSize: compactNoScroll ? "0.78rem" : useBottomSheet ? "0.8rem" : "0.83rem",
                                    lineHeight: 1.45,
                                }}
                            >
                                {selectedStory?.knownSinceDate ? (
                                    <div>
                                        Known in river since: <strong style={{ color: "#0f172a" }}>{formatStoryDate(selectedStory.knownSinceDate)}</strong>
                                    </div>
                                ) : null}
                                {selectedStory?.recoveredOnDate ? (
                                    <div>
                                        Recovered on: <strong style={{ color: "#0f172a" }}>{formatStoryDate(selectedStory.recoveredOnDate)}</strong>
                                    </div>
                                ) : null}
                                {timeInRiverLabel ? (
                                    <div>
                                        Time in river: <strong style={{ color: "#0f172a" }}>{timeInRiverLabel}</strong>
                                    </div>
                                ) : null}
                                {selectedStory?.referenceImageUrl ? (
                                    <div style={{ color: "#1d4ed8", fontWeight: 600 }}>
                                        Includes reference image in fullscreen viewer.
                                    </div>
                                ) : null}
                                {selectedStory?.referenceImageCaption ? (
                                    <a
                                        href={selectedStory.referenceImageCaption}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ color: "#1d4ed8", fontWeight: 700, width: "fit-content" }}
                                    >
                                        Open Street View source
                                    </a>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    {/* Right: details + actions */}
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
                        <div style={{
                            display: "grid",
                            gap: compactNoScroll ? "7px" : useBottomSheet ? "8px" : useDenseDesktopCard ? "7px" : "10px",
                            marginBottom: compactNoScroll ? "6px" : useBottomSheet ? "6px" : "6px",
                        }}>
                            <div style={{ color: "#64748b", fontSize: compactNoScroll ? "0.8rem" : "0.84rem" }}>
                                Spotted: {new Date(selectedItem.created_at).toLocaleString()}
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: statGridColumns, gap: "8px", minWidth: 0 }}>
                                <DetailBadge
                                    label="Status"
                                    value={selectedCounts.isRecovered ? "Recovered" : "In Water"}
                                    tone={selectedCounts.isRecovered ? "success" : "warning"}
                                    compact={compactNoScroll || useDenseDesktopCard}
                                />
                                <DetailBadge label="Total" value={selectedCounts.total} compact={compactNoScroll || useDenseDesktopCard} />
                                <DetailBadge label="Recovered" value={selectedCounts.recovered} compact={compactNoScroll || useDenseDesktopCard} />
                                <DetailBadge label="In Water" value={selectedCounts.inWater} compact={compactNoScroll || useDenseDesktopCard} />
                            </div>

                            {selectedWeight ? (
                                <div
                                    style={{
                                        display: "grid",
                                        gap: "2px",
                                        padding: compactNoScroll ? "8px 9px" : useBottomSheet ? "8px 9px" : "10px 11px",
                                        borderRadius: "12px",
                                        border: "1px solid #dbe3ee",
                                        background: "#f8fafc",
                                        color: "#334155",
                                        fontSize: compactNoScroll ? "0.78rem" : useBottomSheet ? "0.8rem" : "0.83rem",
                                        lineHeight: 1.45,
                                    }}
                                >
                                    <div>
                                        Est. weight per item: <strong style={{ color: "#0f172a" }}>{formatWeightKg(selectedWeight.value)}</strong>
                                        {selectedWeight.source === "default" ? " (default)" : ""}
                                    </div>
                                    <div>
                                        Est. total at location: <strong style={{ color: "#0f172a" }}>{formatWeightKg(selectedWeight.value * selectedCounts.total)}</strong>
                                    </div>
                                </div>
                            ) : null}

                            <LocationDetailsBlock
                                gps={selectedGps}
                                geoLookup={selectedGeoLookup}
                                isResolving={isResolvingGeoLookup}
                                mapsUrl={selectedMapsUrl}
                                compact={compactNoScroll || useDenseDesktopCard}
                                w3wAddress={selectedItem.w3w_address ?? null}
                            />

                            {copiedShareItemId === selectedItem.id && shareCopyStatus ? (
                                <div style={{ marginTop: "4px", color: "#0f766e", fontWeight: 600, fontSize: "0.78rem" }}>
                                    {shareCopyStatus}
                                </div>
                            ) : null}
                        </div>

                        {!canManageItems ? (
                            <div style={{
                                marginBottom: compactNoScroll ? "8px" : useBottomSheet ? "12px" : "8px",
                                padding: compactNoScroll ? "7px 8px" : useBottomSheet ? "9px 10px" : "8px 9px",
                                borderRadius: "8px",
                                border: "1px solid #fde68a",
                                background: "#fffbeb",
                                color: "#92400e",
                                fontSize: compactNoScroll ? "0.74rem" : useBottomSheet ? "0.82rem" : "0.8rem",
                            }}>
                                Read-only mode: only authorized GitHub accounts can edit or delete locations.
                            </div>
                        ) : null}

                        {canManageItems && editingItemId === selectedItem.id ? (
                            <div style={{ textAlign: "left" }}>
                                <div style={{ marginBottom: "8px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Type</label>
                                    <select
                                        value={editForm.type}
                                        onChange={(e) =>
                                            setEditForm((prev) => {
                                                const nextType = e.target.value;
                                                const previousDefaultWeight = getDefaultWeightForType(prev.type);
                                                const nextDefaultWeight = getDefaultWeightForType(nextType);
                                                const parsedExistingWeight = parseEstimatedWeightKg(prev.estimatedWeight);
                                                const shouldSyncDefaultWeight =
                                                    parsedExistingWeight === null ||
                                                    Math.abs(parsedExistingWeight - previousDefaultWeight) < 0.1;

                                                return {
                                                    ...prev,
                                                    type: nextType,
                                                    estimatedWeight: shouldSyncDefaultWeight
                                                        ? String(nextDefaultWeight)
                                                        : prev.estimatedWeight,
                                                };
                                            })
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                        }}
                                    >
                                        <option value="bike">Bike</option>
                                        <option value="historic">Historic find</option>
                                        <option value="motorbike">Motorbike</option>
                                        <option value="trolley">Trolley</option>
                                        <option value="misc">Misc</option>
                                    </select>
                                </div>

                                <div style={{ marginBottom: "8px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Estimated Weight Per Item (kg)</label>
                                    <input
                                        type="number"
                                        min="0.1"
                                        step="0.1"
                                        value={editForm.estimatedWeight}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({
                                                ...prev,
                                                estimatedWeight: e.target.value,
                                            }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "8px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Total at Location</label>
                                    <input
                                        type="number"
                                        min="1"
                                        value={editForm.total}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({
                                                ...prev,
                                                total: clampInt(e.target.value, 1),
                                            }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Recovered Count</label>
                                    <input
                                        type="number"
                                        min="0"
                                        max={Math.max(1, clampInt(editForm.total, 1))}
                                        value={editForm.recovered}
                                        onChange={(e) =>
                                            setEditForm((prev) => {
                                                const nextTotal = Math.max(1, clampInt(prev.total, 1));
                                                return {
                                                    ...prev,
                                                    recovered: Math.min(nextTotal, clampInt(e.target.value, 0)),
                                                };
                                            })
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Latitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        placeholder="e.g. 54.0466"
                                        value={editForm.lat}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, lat: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Longitude</label>
                                    <input
                                        type="number"
                                        step="any"
                                        placeholder="e.g. -2.8007"
                                        value={editForm.lng}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, lng: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Known In River Since</label>
                                    <input
                                        type="date"
                                        value={editForm.knownSinceDate}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, knownSinceDate: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Recovered On</label>
                                    <input
                                        type="date"
                                        value={editForm.recoveredOnDate}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, recoveredOnDate: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ marginBottom: "10px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Reference Image URL</label>
                                    <input
                                        type="url"
                                        placeholder="https://..."
                                        value={editForm.referenceImageUrl}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, referenceImageUrl: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />

                                    <div style={{ marginTop: "8px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                                        <button
                                            type="button"
                                            onClick={() => onUploadReferenceImage?.()}
                                            disabled={Boolean(isUploadingReferenceImage)}
                                            style={{
                                                border: "1px solid #bfdbfe",
                                                background: "#eff6ff",
                                                color: "#1d4ed8",
                                                borderRadius: "999px",
                                                padding: "7px 12px",
                                                fontSize: "0.78rem",
                                                fontWeight: 700,
                                                cursor: isUploadingReferenceImage ? "not-allowed" : "pointer",
                                                opacity: isUploadingReferenceImage ? 0.65 : 1,
                                            }}
                                        >
                                            {isUploadingReferenceImage ? "Uploading..." : "Upload Reference Image"}
                                        </button>
                                    </div>
                                </div>

                                <div style={{ marginBottom: "12px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Street View / Source Link</label>
                                    <input
                                        type="url"
                                        placeholder="https://maps.google.com/..."
                                        value={editForm.referenceImageCaption}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({ ...prev, referenceImageCaption: e.target.value }))
                                        }
                                        style={{
                                            width: "100%",
                                            marginTop: "4px",
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "6px",
                                            padding: "8px",
                                            boxSizing: "border-box",
                                        }}
                                    />
                                </div>

                                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                    <button
                                        onClick={() => saveItemEdits(selectedItem.id)}
                                        disabled={isUpdatingItemId === selectedItem.id}
                                        style={{
                                            flex: "1 1 90px",
                                            padding: "10px",
                                            border: "none",
                                            background: "#1d4ed8",
                                            color: "#fff",
                                            borderRadius: "6px",
                                            fontWeight: 700,
                                            cursor: "pointer",
                                        }}
                                    >
                                        Save
                                    </button>
                                    <button
                                        onClick={() => setEditingItemId(null)}
                                        disabled={isUpdatingItemId === selectedItem.id}
                                        style={{
                                            flex: "1 1 90px",
                                            padding: "10px",
                                            border: "1px solid #cbd5e1",
                                            background: "#fff",
                                            color: "#334155",
                                            borderRadius: "6px",
                                            fontWeight: 600,
                                            cursor: "pointer",
                                        }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        ) : canManageItems ? (
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "0" }}>
                                {!selectedCounts.isRecovered && (
                                    <button
                                        style={{
                                            flex: "1 1 100%",
                                            marginTop: "0",
                                            padding: compactNoScroll ? "8px" : "10px",
                                            backgroundColor: "#2ecc71",
                                            color: "white",
                                            border: "none",
                                            borderRadius: "6px",
                                            fontWeight: "bold",
                                            cursor: "pointer",
                                            fontSize: compactNoScroll ? "0.8rem" : "0.9rem",
                                        }}
                                        onClick={() => {
                                            setEditingItemId(selectedItem.id);
                                            setEditForm({
                                                type: normalizeType(selectedItem.type),
                                                total: selectedCounts.total,
                                                recovered: selectedCounts.total,
                                                estimatedWeight: String(selectedWeight?.value || getDefaultWeightForType(selectedItem.type)),
                                                lat: selectedGps ? String(selectedGps.latitude) : "",
                                                lng: selectedGps ? String(selectedGps.longitude) : "",
                                                knownSinceDate: normalizeOptionalDateInput(selectedStory?.knownSinceDate),
                                                recoveredOnDate: normalizeOptionalDateInput(selectedStory?.recoveredOnDate),
                                                referenceImageUrl: selectedStory?.referenceImageUrl || "",
                                                referenceImageCaption: selectedStory?.referenceImageCaption || "",
                                            });
                                        }}
                                    >
                                        Mark All Recovered
                                    </button>
                                )}
                                <button
                                    onClick={() => startEditingItem(selectedItem)}
                                    style={{
                                        flex: "1 1 90px",
                                        padding: compactNoScroll ? "8px" : "10px",
                                        border: "1px solid #cbd5e1",
                                        background: "#fff",
                                        color: "#0f172a",
                                        borderRadius: "6px",
                                        fontWeight: 600,
                                        cursor: "pointer",
                                    }}
                                >
                                    Edit
                                </button>
                                <button
                                    onClick={() => removeLocation(selectedItem.id)}
                                    disabled={isUpdatingItemId === selectedItem.id}
                                    style={{
                                        flex: "1 1 90px",
                                        padding: compactNoScroll ? "8px" : "10px",
                                        border: "none",
                                        background: "#dc2626",
                                        color: "#fff",
                                        borderRadius: "6px",
                                        fontWeight: 700,
                                        cursor: "pointer",
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </>
    );

    return createPortal(drawerNode, document.body);
}

function StationPopupContent({ station, reading }) {
    const fallbackParameterName = getEaPrimaryMeasure(station, "level")?.parameterName || "";

    const parameterName = reading?.parameterName || fallbackParameterName || "Latest reading";
    const sensorSubLabel = station?.riverName ? `${station.riverName} · EA Sensor` : "EA Sensor";
    const timestampText = formatEaReadingDateTime(reading?.dateTime);
    const rawValue = Number(reading?.value);
    const hasValue = Number.isFinite(rawValue);
    const valueText = hasValue ? rawValue.toLocaleString(undefined, { maximumFractionDigits: 3 }) : null;
    const readingText = hasValue
        ? `${valueText}${reading?.unitName ? ` ${reading.unitName}` : ""}`
        : "Reading unavailable";
    const readingUnit = reading?.unitName || "";
    const trendRawDelta = Number(reading?.trendDeltaValue);
    const hasTrendDelta = Number.isFinite(trendRawDelta);
    const trendDeltaSign = hasTrendDelta && trendRawDelta > 0 ? "+" : "";
    const trendDeltaText = hasTrendDelta
        ? `${trendDeltaSign}${trendRawDelta.toLocaleString(undefined, { maximumFractionDigits: 3 })}${readingUnit ? ` ${readingUnit}` : ""}`
        : null;
    const trendLabel = typeof reading?.trendLabel === "string" && reading.trendLabel ? reading.trendLabel : "Trend unavailable";
    const trendDirection = typeof reading?.trendDirection === "string" ? reading.trendDirection : "flat";
    const trendColor =
        trendDirection === "up"
            ? "#047857"
            : trendDirection === "down"
              ? "#c2410c"
              : "#334155";
    const trendSymbol = trendDirection === "up" ? "↑" : trendDirection === "down" ? "↓" : "→";
    const flowRawValue = Number(reading?.flowValue);
    const hasFlowValue = Number.isFinite(flowRawValue);
    const flowValueText = hasFlowValue
        ? flowRawValue.toLocaleString(undefined, { maximumFractionDigits: 3 })
        : "";
    const flowUnit = reading?.flowUnitName || "";
    const flowDateText = formatEaReadingDateTime(reading?.flowDateTime);
    const flowTrendDirection = typeof reading?.flowTrendDirection === "string" ? reading.flowTrendDirection : "flat";
    const flowTrendLabel = typeof reading?.flowTrendLabel === "string" && reading.flowTrendLabel ? reading.flowTrendLabel : "Stable";
    const flowTrendColor =
        flowTrendDirection === "up"
            ? "#047857"
            : flowTrendDirection === "down"
              ? "#c2410c"
              : "#334155";
    const isMainMeasureFlow = /flow/i.test(parameterName);
    const shouldShowFlowRow = hasFlowValue && flowRawValue !== 0 && !isMainMeasureFlow;
    const recentReadings = Array.isArray(reading?.recentReadings) ? reading.recentReadings.slice(0, 3) : [];
    const [activeRecentIndex, setActiveRecentIndex] = useState(0);

    useEffect(() => {
        setActiveRecentIndex(0);
    }, [station?.stationReference, station?.notation, station?.["@id"], reading?.dateTime]);

    useEffect(() => {
        if (!recentReadings.length) return;
        if (activeRecentIndex <= recentReadings.length - 1) return;
        setActiveRecentIndex(recentReadings.length - 1);
    }, [activeRecentIndex, recentReadings]);

    const activeRecent = recentReadings[activeRecentIndex] || null;

    return (
        <div
            style={{
                width: "220px",
                display: "grid",
                gap: "8px",
                color: "#0f172a",
                fontFamily:
                    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif',
            }}
        >
            <div style={{ display: "grid", gap: "3px" }}>
                <div style={{ fontWeight: 800, fontSize: "0.92rem", lineHeight: 1.2 }}>{station?.label || "EA Station"}</div>
                <div style={{ fontSize: "0.72rem", color: "#0f766e", fontWeight: 700 }}>{sensorSubLabel}</div>
            </div>

            <div
                style={{
                    border: "1px solid #99f6e4",
                    borderRadius: UI_TOKENS.radius.sm,
                    background: "#f0fdfa",
                    padding: "7px 9px",
                    display: "grid",
                    gap: "4px",
                }}
            >
                <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#0f766e", letterSpacing: "0.04em", textTransform: "uppercase" }}>
                    {parameterName}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                    <div style={{ fontSize: "0.98rem", fontWeight: 800, color: "#134e4a" }}>
                        {reading?.loading ? "Loading latest reading..." : readingText}
                    </div>
                    {!reading?.loading && !reading?.error && hasValue ? (
                        <div
                            style={{
                                border: `1px solid ${trendColor === "#334155" ? "#cbd5e1" : trendColor}`,
                                background: "#ffffff",
                                color: trendColor,
                                fontSize: "0.67rem",
                                fontWeight: 800,
                                borderRadius: "999px",
                                padding: "2px 7px",
                                whiteSpace: "nowrap",
                            }}
                        >
                            {trendSymbol} {trendLabel}
                        </div>
                    ) : null}
                </div>
                {reading?.error && !reading?.loading ? (
                    <div style={{ fontSize: "0.72rem", color: "#b91c1c" }}>Could not load current value.</div>
                ) : null}
                {shouldShowFlowRow ? (
                    <div
                        style={{
                            marginTop: "2px",
                            borderTop: "1px solid #ccfbf1",
                            paddingTop: "4px",
                            display: "grid",
                            gap: "3px",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                            <div style={{ fontSize: "0.68rem", color: "#0f766e", fontWeight: 700, letterSpacing: "0.02em" }}>FLOW</div>
                            <div
                                style={{
                                    border: `1px solid ${flowTrendColor === "#334155" ? "#cbd5e1" : flowTrendColor}`,
                                    background: "#ffffff",
                                    color: flowTrendColor,
                                    fontSize: "0.67rem",
                                    fontWeight: 800,
                                    borderRadius: "999px",
                                    padding: "2px 7px",
                                    whiteSpace: "nowrap",
                                }}
                            >
                                {flowTrendDirection === "up" ? "↑" : flowTrendDirection === "down" ? "↓" : "→"} {flowTrendLabel}
                            </div>
                        </div>
                        <div style={{ fontSize: "0.8rem", color: "#134e4a", fontWeight: 800 }}>
                            {flowValueText}
                            {flowUnit ? ` ${flowUnit}` : ""}
                        </div>
                        {flowDateText ? <div style={{ fontSize: "0.68rem", color: "#475569" }}>Updated {flowDateText}</div> : null}
                    </div>
                ) : null}
                {!reading?.loading && !reading?.error && recentReadings.length ? (
                    <div
                        style={{
                            marginTop: "2px",
                            borderTop: "1px solid #ccfbf1",
                            paddingTop: "4px",
                            display: "grid",
                            gap: "4px",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px" }}>
                            <div style={{ fontSize: "0.68rem", color: "#0f766e", fontWeight: 700, letterSpacing: "0.02em" }}>LAST 3 READINGS</div>
                            {recentReadings.length > 1 ? (
                                <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                    <button
                                        type="button"
                                        onClick={() => setActiveRecentIndex((prev) => (prev - 1 + recentReadings.length) % recentReadings.length)}
                                        style={{ border: "1px solid #99f6e4", borderRadius: "999px", background: "#ffffff", color: "#0f766e", width: "18px", height: "18px", lineHeight: 1, fontSize: "0.68rem", padding: 0, cursor: "pointer" }}
                                        aria-label="Show previous reading"
                                    >
                                        ‹
                                    </button>
                                    <div style={{ fontSize: "0.64rem", color: "#0f766e", fontWeight: 700 }}>
                                        {activeRecentIndex + 1}/{recentReadings.length}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setActiveRecentIndex((prev) => (prev + 1) % recentReadings.length)}
                                        style={{ border: "1px solid #99f6e4", borderRadius: "999px", background: "#ffffff", color: "#0f766e", width: "18px", height: "18px", lineHeight: 1, fontSize: "0.68rem", padding: 0, cursor: "pointer" }}
                                        aria-label="Show next reading"
                                    >
                                        ›
                                    </button>
                                </div>
                            ) : null}
                        </div>
                        {activeRecent ? (
                            <div style={{ border: "1px dashed #99f6e4", borderRadius: "8px", padding: "4px 6px", background: "#ffffff", display: "grid", gap: "2px" }}>
                                <div style={{ fontSize: "0.8rem", color: "#134e4a", fontWeight: 800 }}>
                                    {Number(activeRecent.value).toLocaleString(undefined, { maximumFractionDigits: 3 })}
                                    {readingUnit ? ` ${readingUnit}` : ""}
                                </div>
                                <div style={{ fontSize: "0.68rem", color: "#475569" }}>
                                    {activeRecent.ageLabel || "Age unavailable"}
                                    {activeRecent.dateTime ? ` • ${formatEaReadingDateTime(activeRecent.dateTime) || ""}` : ""}
                                </div>
                            </div>
                        ) : null}
                        <div style={{ fontSize: "0.72rem", color: trendColor, fontWeight: 700 }}>
                            {trendSymbol} {trendDeltaText || "Change unavailable"} over latest {recentReadings.length}
                        </div>
                        {recentReadings.length > 1 ? (
                            <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                {recentReadings.map((_, index) => (
                                    <button
                                        key={`reading-dot-${index}`}
                                        type="button"
                                        onClick={() => setActiveRecentIndex(index)}
                                        aria-label={`Show reading ${index + 1}`}
                                        style={{
                                            width: index === activeRecentIndex ? "9px" : "7px",
                                            height: index === activeRecentIndex ? "9px" : "7px",
                                            borderRadius: "50%",
                                            border: "none",
                                            padding: 0,
                                            background: index === activeRecentIndex ? "#0f766e" : "#99f6e4",
                                            cursor: "pointer",
                                        }}
                                    />
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}
                {!reading?.loading && timestampText ? (
                    <div style={{ fontSize: "0.72rem", color: "#0f766e" }}>Updated {timestampText}</div>
                ) : null}
            </div>

            {station?.town ? <div style={{ fontSize: "0.76rem", color: "#334155" }}>Town: {station.town}</div> : null}

            {Number.isFinite(Number(station?.lat)) && Number.isFinite(Number(station?.long)) ? (
                <a
                    href={createMapsUrl(Number(station.lat), Number(station.long))}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "0.76rem", color: "#0369a1", fontWeight: 700, textDecoration: "none" }}
                >
                    Open in Maps
                </a>
            ) : null}

            <div style={{ fontSize: "0.68rem", color: "#64748b" }}>Environment Agency · Open Government Licence</div>
        </div>
    );
}

const FLOOD_SEVERITY_CONFIG = {
    1: { label: "Severe Flood Warning", color: "#991b1b", bg: "#fff5f5", border: "#fecaca", dot: "#dc2626" },
    2: { label: "Flood Warning", color: "#92400e", bg: "#fffbeb", border: "#fde68a", dot: "#d97706" },
    3: { label: "Flood Alert", color: "#78350f", bg: "#fefce8", border: "#fde68a", dot: "#f59e0b" },
};

function FloodStatusPanel({ floodAlerts, isLoadingFloodAlerts, floodAlertsError, floodAlertsUpdatedAt, isMobile }) {
    const [isOpen, setIsOpen] = useState(false);
    const panelRef = useRef(null);

    const hasAlerts = floodAlerts.length > 0;
    const highest = hasAlerts ? floodAlerts[0] : null;
    const sevConf = highest ? (FLOOD_SEVERITY_CONFIG[highest.severityLevel] || FLOOD_SEVERITY_CONFIG[3]) : null;
    const visibleAlerts = floodAlerts.slice(0, 3);
    const overflowCount = floodAlerts.length - visibleAlerts.length;

    useEffect(() => {
        if (!isOpen || !isMobile) return undefined;

        const handlePointerDown = (event) => {
            if (!panelRef.current?.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [isOpen, isMobile]);

    let pillBg = "rgba(255,255,255,0.96)";
    let pillBorder = "#e2e8f0";
    let pillDot = "#22c55e";
    let pillText = "No active flood alerts";
    let pillTextColor = "#64748b";

    if (isLoadingFloodAlerts && !hasAlerts) {
        pillDot = "#94a3b8";
        pillText = "Checking flood status\u2026";
        pillTextColor = "#94a3b8";
    } else if (floodAlertsError) {
        pillDot = "#cbd5e1";
        pillText = "Flood status unavailable";
        pillTextColor = "#94a3b8";
    } else if (hasAlerts && sevConf) {
        pillBg = sevConf.bg;
        pillBorder = sevConf.border;
        pillDot = sevConf.dot;
        pillText = `${floodAlerts.length} flood alert${floodAlerts.length !== 1 ? "s" : ""} in area`;
        pillTextColor = sevConf.color;
    }

    return (
        <div
            style={{
                position: "absolute",
                top: "10px",
                left: "50%",
                transform: "translateX(-50%)",
                zIndex: 900,
                pointerEvents: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
            }}
        >
            <div
                ref={panelRef}
                style={{
                    display: "inline-flex",
                    flexDirection: "column",
                    alignItems: "center",
                    pointerEvents: "auto",
                    position: "relative",
                }}
                onMouseEnter={!isMobile ? () => setIsOpen(true) : undefined}
                onMouseLeave={!isMobile ? () => setIsOpen(false) : undefined}
            >
                <button
                    type="button"
                    onClick={isMobile ? () => setIsOpen((prev) => !prev) : undefined}
                    aria-expanded={isOpen}
                    aria-label={pillText}
                    style={{
                        border: `1px solid ${pillBorder}`,
                        borderRadius: UI_TOKENS.radius.pill,
                        background: pillBg,
                        backdropFilter: "blur(6px)",
                        WebkitBackdropFilter: "blur(6px)",
                        padding: "5px 10px 5px 9px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        boxShadow: "0 4px 14px rgba(15,23,42,0.12)",
                        cursor: "pointer",
                        maxWidth: "min(90vw, 280px)",
                        minWidth: 0,
                    }}
                >
                    <span
                        aria-hidden="true"
                        style={{
                            width: "7px",
                            height: "7px",
                            borderRadius: "50%",
                            flexShrink: 0,
                            background: pillDot,
                        }}
                    />
                    <span
                        style={{
                            fontSize: "0.72rem",
                            fontWeight: 700,
                            color: pillTextColor,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            minWidth: 0,
                        }}
                    >
                        {pillText}
                    </span>
                    <span
                        aria-hidden="true"
                        style={{ fontSize: "0.6rem", color: pillTextColor, opacity: 0.65, flexShrink: 0 }}
                    >
                        {isOpen ? "▴" : "▾"}
                    </span>
                </button>

                <div
                    style={{
                        position: "absolute",
                        top: "calc(100% + 5px)",
                        left: "50%",
                        width: "min(90vw, 300px)",
                        opacity: isOpen ? 1 : 0,
                        transform: isOpen
                            ? "translateX(-50%) translateY(0) scale(1)"
                            : "translateX(-50%) translateY(-6px) scale(0.97)",
                        transformOrigin: "top center",
                        transition: "opacity 160ms ease, transform 180ms ease",
                        pointerEvents: isOpen ? "auto" : "none",
                    }}
                >
                    <SurfaceCard style={{ padding: "10px", display: "grid", gap: "8px" }}>
                        {floodAlertsUpdatedAt ? (
                            <div style={{ fontSize: "0.68rem", color: "#94a3b8", fontWeight: 600, textAlign: "center" }}>
                                Last checked: {floodAlertsUpdatedAt} · updates every 15 min
                            </div>
                        ) : null}

                        {!hasAlerts && !floodAlertsError && !isLoadingFloodAlerts ? (
                            <div style={{ fontSize: "0.76rem", color: "#374151", fontWeight: 600, textAlign: "center", padding: "2px 0" }}>
                                No active flood alerts in the River Lune area.
                            </div>
                        ) : null}

                        {isLoadingFloodAlerts && !hasAlerts ? (
                            <div style={{ fontSize: "0.76rem", color: "#94a3b8", textAlign: "center", padding: "2px 0" }}>
                                Loading flood data...
                            </div>
                        ) : null}

                        {floodAlertsError ? (
                            <div style={{ fontSize: "0.76rem", color: "#94a3b8", textAlign: "center", padding: "2px 0" }}>
                                Could not load flood data from the Environment Agency.
                            </div>
                        ) : null}

                        {hasAlerts ? (
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "4px",
                                }}
                            >
                                {visibleAlerts.map((alert) => {
                                    const cfg = FLOOD_SEVERITY_CONFIG[alert.severityLevel] || FLOOD_SEVERITY_CONFIG[3];
                                    return (
                                        <div
                                            key={alert.id}
                                            style={{
                                                border: `1px solid ${cfg.border}`,
                                                borderRadius: UI_TOKENS.radius.sm,
                                                background: cfg.bg,
                                                padding: "7px 10px",
                                                fontSize: "0.72rem",
                                                lineHeight: 1.35,
                                            }}
                                        >
                                            <div
                                                style={{
                                                    fontWeight: 800,
                                                    color: cfg.color,
                                                    marginBottom: "2px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "5px",
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        width: "6px",
                                                        height: "6px",
                                                        borderRadius: "50%",
                                                        background: cfg.dot,
                                                        flexShrink: 0,
                                                        display: "inline-block",
                                                    }}
                                                />
                                                {alert.severity}
                                            </div>
                                            <div style={{ color: "#374151", fontWeight: 600 }}>{alert.areaName}</div>
                                            {alert.message ? (
                                                <div
                                                    style={{
                                                        color: "#6b7280",
                                                        marginTop: "3px",
                                                        display: "-webkit-box",
                                                        WebkitLineClamp: 2,
                                                        WebkitBoxOrient: "vertical",
                                                        overflow: "hidden",
                                                    }}
                                                >
                                                    {alert.message}
                                                </div>
                                            ) : null}
                                            {alert.timeIssued ? (
                                                <div style={{ color: "#9ca3af", marginTop: "3px" }}>{alert.timeIssued}</div>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : null}

                        {overflowCount > 0 ? (
                            <div
                                style={{
                                    fontSize: "0.7rem",
                                    color: "#64748b",
                                    fontWeight: 700,
                                    textAlign: "center",
                                    padding: "3px 0",
                                }}
                            >
                                +{overflowCount} more
                            </div>
                        ) : null}

                        <div style={{ fontSize: "0.65rem", color: "#cbd5e1", textAlign: "center" }}>
                            Environment Agency · Open Government Licence
                        </div>
                    </SurfaceCard>
                </div>
            </div>
        </div>
    );
}

function ContributorMobileSheet({ contributor, mapsUrl, onClose }) {
    useEffect(() => {
        if (!contributor) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === "Escape") onClose();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [contributor, onClose]);

    if (!contributor || typeof document === "undefined") return null;

    return createPortal(
        <>
            <div
                onClick={onClose}
                style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(2, 6, 23, 0.36)",
                    zIndex: 1501,
                }}
            />

            <div
                role="dialog"
                aria-modal="true"
                aria-label={`${contributor.name || "Contributor"} details`}
                style={{
                    position: "fixed",
                    left: "8px",
                    right: "8px",
                    bottom: "max(8px, env(safe-area-inset-bottom, 0px))",
                    maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px)",
                    borderRadius: "22px",
                    border: "1px solid #dbe5f4",
                    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                    boxShadow: "0 22px 48px rgba(2, 6, 23, 0.34)",
                    zIndex: 1502,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                }}
            >
                <div
                    aria-hidden="true"
                    style={{
                        width: "44px",
                        height: "5px",
                        borderRadius: "999px",
                        background: "#d5dde9",
                        margin: "10px auto 8px",
                        flexShrink: 0,
                    }}
                />

                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: "10px",
                        padding: "0 12px 10px",
                        borderBottom: "1px solid #e2e8f0",
                    }}
                >
                    <div style={{ minWidth: 0, display: "grid", gap: "4px" }}>
                        <strong
                            style={{
                                color: "#0f172a",
                                fontSize: "1.06rem",
                                lineHeight: 1.15,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                            }}
                        >
                            {contributor.name || "Contributor"}
                        </strong>
                        <span
                            style={{
                                display: "inline-flex",
                                width: "fit-content",
                                alignItems: "center",
                                justifyContent: "center",
                                padding: "2px 7px",
                                borderRadius: "999px",
                                border: "1px solid #fcd34d",
                                background: "#fffbeb",
                                color: "#92400e",
                                fontSize: "0.64rem",
                                fontWeight: 700,
                                letterSpacing: "0.02em",
                                textTransform: "uppercase",
                            }}
                        >
                            Contributed
                        </span>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        style={{
                            border: "1px solid #dbe3ee",
                            background: "#fff",
                            borderRadius: "999px",
                            width: "34px",
                            height: "34px",
                            fontWeight: 700,
                            color: "#475569",
                            boxShadow: "0 8px 18px rgba(15,23,42,0.09)",
                            cursor: "pointer",
                            flexShrink: 0,
                        }}
                        aria-label="Close contributor details"
                    >
                        ×
                    </button>
                </div>

                <div
                    style={{
                        overflowY: "auto",
                        padding: "10px 12px calc(env(safe-area-inset-bottom, 0px) + 12px)",
                        display: "grid",
                        gap: "10px",
                    }}
                >
                    <div
                        style={{
                            borderRadius: "14px",
                            border: "1px solid #dbe5f4",
                            background: "linear-gradient(140deg, #f8fafc 0%, #eef4ff 100%)",
                            display: "grid",
                            gap: "10px",
                            padding: "11px",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <div
                                style={{
                                    width: "72px",
                                    height: "72px",
                                    borderRadius: "12px",
                                    border: "1px solid #cbd5e1",
                                    background: "#f8fafc",
                                    display: "grid",
                                    placeItems: "center",
                                    overflow: "hidden",
                                    flexShrink: 0,
                                }}
                            >
                                {contributor.logo_url ? (
                                    <img
                                        src={contributor.logo_url}
                                        alt={`${contributor.name || "Business"} logo`}
                                        loading="lazy"
                                        style={{
                                            width: "100%",
                                            height: "100%",
                                            maxWidth: "64px",
                                            maxHeight: "64px",
                                            objectFit: "contain",
                                            borderRadius: "8px",
                                        }}
                                    />
                                ) : (
                                    <div
                                        aria-hidden="true"
                                        style={{
                                            width: "64px",
                                            height: "64px",
                                            borderRadius: "10px",
                                            border: "1px dashed #94a3b8",
                                            background: "linear-gradient(140deg, #e2e8f0, #cbd5e1)",
                                        }}
                                    />
                                )}
                            </div>

                            <p
                                style={{
                                    margin: 0,
                                    color: "#334155",
                                    fontSize: "0.82rem",
                                    lineHeight: 1.45,
                                    overflowWrap: "anywhere",
                                    wordBreak: "break-word",
                                }}
                            >
                                Local business supporting river cleanup efforts.
                            </p>
                        </div>

                        <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                            {contributor.website_url ? (
                                <a
                                    href={contributor.website_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        minHeight: "34px",
                                        borderRadius: "999px",
                                        border: "1px solid #93c5fd",
                                        background: "#eff6ff",
                                        color: "#1d4ed8",
                                        textDecoration: "none",
                                        fontSize: "0.76rem",
                                        fontWeight: 700,
                                        padding: "0 9px",
                                    }}
                                >
                                    Visit website
                                </a>
                            ) : null}
                            {mapsUrl ? (
                                <a
                                    href={mapsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        minHeight: "34px",
                                        borderRadius: "999px",
                                        border: "1px solid #2563eb",
                                        background: "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
                                        color: "#ffffff",
                                        textDecoration: "none",
                                        fontSize: "0.76rem",
                                        fontWeight: 700,
                                        padding: "0 9px",
                                    }}
                                >
                                    Open in Maps
                                </a>
                            ) : null}
                        </div>
                    </div>

                    {contributor.description ? (
                        <div
                            style={{
                                borderRadius: "12px",
                                border: "1px solid #e2e8f0",
                                background: "#ffffff",
                                padding: "10px",
                                color: "#334155",
                                fontSize: "0.83rem",
                                lineHeight: 1.5,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                            }}
                        >
                            {contributor.description}
                        </div>
                    ) : null}

                    {contributor.contribution_note ? (
                        <div
                            style={{
                                borderRadius: "12px",
                                border: "1px solid #bfdbfe",
                                background: "#eff6ff",
                                padding: "10px",
                                color: "#1e3a8a",
                                fontSize: "0.82rem",
                                fontWeight: 600,
                                lineHeight: 1.5,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                            }}
                        >
                            {contributor.contribution_note}
                        </div>
                    ) : null}
                </div>
            </div>
        </>,
        document.body,
    );
}

function App() {
    const detectMobileViewport = () => {
        if (typeof window === "undefined") return false;

        const smallViewport = window.matchMedia("(max-width: 1024px)").matches;
        const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
        return smallViewport || coarsePointer;
    };

    const [items, setItems] = useState(() => startupStoredState.items);
    const [typeFilter, setTypeFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [pendingLocation, setPendingLocation] = useState(null);
    const [pendingItemType, setPendingItemType] = useState(null);
    const [isSavingItem, setIsSavingItem] = useState(false);
    const [isPickingImage, setIsPickingImage] = useState(false);
    const [isUploadingReferenceImage, setIsUploadingReferenceImage] = useState(false);
    const [uploadProgressText, setUploadProgressText] = useState("");
    const [pendingCount, setPendingCount] = useState(1);
    const [editingItemId, setEditingItemId] = useState(null);
    const [editForm, setEditForm] = useState({
        type: "misc",
        total: 1,
        recovered: 0,
        estimatedWeight: String(getDefaultWeightForType("misc")),
        lat: "",
        lng: "",
        knownSinceDate: "",
        recoveredOnDate: "",
        referenceImageUrl: "",
        referenceImageCaption: "",
    });
    const [isUpdatingItemId, setIsUpdatingItemId] = useState(null);
    const [lastSaveResult, setLastSaveResult] = useState(null); // { itemId, status: 'success'|'error' }
    const saveResultTimeoutRef = useRef(null);
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [querySelectedItemId, setQuerySelectedItemId] = useState(() => readSelectedItemIdFromQuery());
    const [querySelectedPoiSlug, setQuerySelectedPoiSlug] = useState(() => readSelectedPoiSlugFromQuery());
    const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
    const [isTidePlannerCollapsed, setIsTidePlannerCollapsed] = useState(true);
    const [lancasterTideRows, setLancasterTideRows] = useState([]);
    const [isLoadingLancasterTides, setIsLoadingLancasterTides] = useState(false);
    const [lancasterTideError, setLancasterTideError] = useState("");
    const [lancasterTideUpdatedAt, setLancasterTideUpdatedAt] = useState("");
    const [isLoadingItems, setIsLoadingItems] = useState(false);
    const [authReady, setAuthReady] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [isAuthActionLoading, setIsAuthActionLoading] = useState(false);
    const [authError, setAuthError] = useState("");
    const [localCounts, setLocalCounts] = useState(() => startupStoredState.counts);
    const [localGps, setLocalGps] = useState(() => startupStoredState.gps);
    const [localWeights, setLocalWeights] = useState(() => startupStoredState.weights);
    const [localGeoLookup, setLocalGeoLookup] = useState(() => startupStoredState.geolookup);
    const [localItemStory, setLocalItemStory] = useState(() => startupStoredState.itemStory);
    const [isResolvingGeoLookup, setIsResolvingGeoLookup] = useState(false);
    const [dbCountFieldSupport, setDbCountFieldSupport] = useState(() =>
        inferDbCountFieldSupport(startupStoredState.items),
    );
    const [dbGpsFieldSupport, setDbGpsFieldSupport] = useState(() =>
        inferDbGpsFieldSupport(startupStoredState.items),
    );
    const [dbWeightFieldSupport, setDbWeightFieldSupport] = useState(() =>
        inferDbWeightFieldSupport(startupStoredState.items),
    );
    const [dbW3wFieldSupport, setDbW3wFieldSupport] = useState(() =>
        inferDbW3wFieldSupport(startupStoredState.items),
    );
    const [dbGeoFieldSupport, setDbGeoFieldSupport] = useState(() =>
        inferDbGeoFieldSupport(startupStoredState.items),
    );
    const [dbStoryFieldSupport, setDbStoryFieldSupport] = useState(() =>
        inferDbStoryFieldSupport(startupStoredState.items),
    );
    const [isMobile, setIsMobile] = useState(detectMobileViewport);
    const [waybackReleases, setWaybackReleases] = useState([]);
    const [selectedWaybackId, setSelectedWaybackId] = useState(null);
    const [isLiveLocationEnabled, setIsLiveLocationEnabled] = useState(false);
    const [liveLocation, setLiveLocation] = useState(null);
    const [liveLocationError, setLiveLocationError] = useState("");
    const [luneStations, setLuneStations] = useState([]);
    const [luneStationReadings, setLuneStationReadings] = useState({});
    const [isLuneStationsVisible, setIsLuneStationsVisible] = useState(true);
    const [regionalFlowStations, setRegionalFlowStations] = useState([]);
    const [regionalFlowReadings, setRegionalFlowReadings] = useState({});
    const [isRegionalFlowStationsVisible, setIsRegionalFlowStationsVisible] = useState(true);
    const [isContributorsVisible, setIsContributorsVisible] = useState(true);
    const [contributors, setContributors] = useState([]);
    const [historicalPois, setHistoricalPois] = useState([]);
    const [isHistoricalPoisVisible, setIsHistoricalPoisVisible] = useState(true);
    const [isPoiPanelOpen, setIsPoiPanelOpen] = useState(false);
    const [selectedHistoricalPoiId, setSelectedHistoricalPoiId] = useState(null);
    const [editingHistoricalPoiId, setEditingHistoricalPoiId] = useState(null);
    const [selectedContributorId, setSelectedContributorId] = useState(null);
    const [isContributorPanelOpen, setIsContributorPanelOpen] = useState(false);
    const [floodAlerts, setFloodAlerts] = useState([]);
    const [isLoadingFloodAlerts, setIsLoadingFloodAlerts] = useState(false);
    const [floodAlertsError, setFloodAlertsError] = useState(null);
    const [floodAlertsUpdatedAt, setFloodAlertsUpdatedAt] = useState("");
    const [historicOverlayDrafts, setHistoricOverlayDrafts] = useState(
        () => startupStoredState.historicOverlayDrafts,
    );
    const [isHistoricOverlayDraftsHydrated, setIsHistoricOverlayDraftsHydrated] = useState(false);
    const [isHistoricOverlayEnabled, setIsHistoricOverlayEnabled] = useState(false);
    const [selectedHistoricOverlayId, setSelectedHistoricOverlayId] = useState(
        DEFAULT_HISTORIC_OVERLAY_ID,
    );
    const [historicOverlayOpacity, setHistoricOverlayOpacity] = useState(
        DEFAULT_HISTORIC_OVERLAY_OPACITY,
    );
    const [historicOverlayError, setHistoricOverlayError] = useState("");
    const [historicOverlaySyncStatus, setHistoricOverlaySyncStatus] = useState({ kind: "idle", message: "" });
    const [historicOverlayLoadError, setHistoricOverlayLoadError] = useState("");
    const [publishingHistoricOverlayId, setPublishingHistoricOverlayId] = useState("");
    const [selectedHistoricOverlayDraftId, setSelectedHistoricOverlayDraftId] = useState(
        HISTORIC_OVERLAY_DRAFT_TEMPLATES[0]?.id || "",
    );
    const [isHistoricOverlayDraftPreviewEnabled, setIsHistoricOverlayDraftPreviewEnabled] = useState(false);
    const [isWeatherOverlayEnabled, setIsWeatherOverlayEnabled] = useState(false);
    const [weatherOverlayTileUrl, setWeatherOverlayTileUrl] = useState("");
    const [weatherOverlayUpdatedAt, setWeatherOverlayUpdatedAt] = useState("");
    const [weatherOverlayError, setWeatherOverlayError] = useState("");
    const [cleanupForecast, setCleanupForecast] = useState(null);
    const [isLoadingCleanupForecast, setIsLoadingCleanupForecast] = useState(false);
    const [cleanupForecastUpdatedAt, setCleanupForecastUpdatedAt] = useState("");
    const [cleanupForecastError, setCleanupForecastError] = useState("");
    const [pendingEstimatedWeight, setPendingEstimatedWeight] = useState("");
    const [reportLocation, setReportLocation] = useState(null);
    const [pendingReportLocation, setPendingReportLocation] = useState(null);
    const [reportNote, setReportNote] = useState("");
    const [reportStatus, setReportStatus] = useState("");
    const [isReportConsentOpen, setIsReportConsentOpen] = useState(false);
    const [hasAcceptedReportConsent, setHasAcceptedReportConsent] = useState(() =>
        readStoredJson(REPORT_CONSENT_STORAGE_KEY, false, (value) => typeof value === "boolean"),
    );
    const [reportCooldownUntil, setReportCooldownUntil] = useState(0);
    const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
    const [isMapToolsOpen, setIsMapToolsOpen] = useState(false);
    const [isMobileStatsExpanded, setIsMobileStatsExpanded] = useState(false);
    const [mapInstance, setMapInstance] = useState(null);
    const [isLiveLocationPaneReady, setIsLiveLocationPaneReady] = useState(false);
    const [copiedShareItemId, setCopiedShareItemId] = useState(null);
    const [shareCopyStatus, setShareCopyStatus] = useState("");
    const [isDeferredUiReady, setIsDeferredUiReady] = useState(false);
    const ignoreNextMapClickRef = useRef(false);
    const mapOverlayRootRef = useRef(null);
    const liveLocationWatchIdRef = useRef(null);
    const liveLocationBestRef = useRef(null);
    const geocodeAttemptedKeysRef = useRef(new Set());
    const shareCopyTimeoutRef = useRef(null);
    const reportStatusTimeoutRef = useRef(null);
    const historicOverlayRemoteSnapshotsRef = useRef(new Map());
    const stickyTopStackRef = useRef(null);
    const [mobileStickyStackHeight, setMobileStickyStackHeight] = useState(0);
    const [isHistoricOverlayEditorModeRequested] = useState(readHistoricOverlayEditorModeFromQuery);
    const canManageItems = useMemo(() => canUserManageItems(currentUser), [currentUser]);
    // Admin-only W3W for pending pin-drop — fetched on demand via the button in PendingPlacementOverlay.
    const [pendingItemW3WWords, setPendingItemW3WWords] = useState(null);
    const [pendingItemW3WLoading, setPendingItemW3WLoading] = useState(false);
    const pendingItemW3WWordsRef = useRef(null);
    pendingItemW3WWordsRef.current = pendingItemW3WWords;
    const isHistoricOverlayEditorModeEnabled =
        canManageItems && isHistoricOverlayEditorModeRequested;
    const canUsePublicReports = ENABLE_PUBLIC_REPORTS && !canManageItems;
    const hasMessengerTarget = Boolean(FACEBOOK_PAGE_RECIPIENT_ID);
    const hasCommunityEmailTarget = Boolean(COMMUNITY_EMAIL_ACCOUNT);
    const messengerThreadUrl = useMemo(
        () => buildMessengerThreadUrl(FACEBOOK_PAGE_RECIPIENT_ID),
        [],
    );
    const reportSourceUrl = useMemo(() => {
        if (typeof window === "undefined") return "";
        return `${window.location.origin}${window.location.pathname}`;
    }, []);
    const floatingMapButtonStyle = {
        position: "absolute",
        zIndex: 900,
        border: "1px solid #cbd5e1",
        background: "rgba(255,255,255,0.94)",
        color: "#0f172a",
        borderRadius: "999px",
        padding: "7px 11px",
        fontSize: "0.78rem",
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: "7px",
        boxShadow: "0 6px 18px rgba(15,23,42,0.14)",
        backdropFilter: "blur(8px)",
        cursor: "pointer",
    };

    const copyShareLinkForItem = async (itemId) => {
        const shareUrl = buildShareItemUrl(itemId);
        if (!shareUrl) return;

        if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
            try {
                await navigator.share({
                    title: "River Bank Cleanup Tracker",
                    text: "Check this cleanup location.",
                    url: shareUrl,
                });

                setCopiedShareItemId(itemId);
                setShareCopyStatus("Share sheet opened.");

                if (shareCopyTimeoutRef.current) {
                    window.clearTimeout(shareCopyTimeoutRef.current);
                }

                shareCopyTimeoutRef.current = window.setTimeout(() => {
                    setCopiedShareItemId(null);
                    setShareCopyStatus("");
                    shareCopyTimeoutRef.current = null;
                }, 2400);

                return;
            } catch (error) {
                if (error?.name === "AbortError") {
                    return;
                }
            }
        }

        try {
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl);
            } else {
                const textArea = document.createElement("textarea");
                textArea.value = shareUrl;
                textArea.setAttribute("readonly", "");
                textArea.style.position = "absolute";
                textArea.style.left = "-9999px";
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand("copy");
                document.body.removeChild(textArea);
            }

            setCopiedShareItemId(itemId);
            setShareCopyStatus("Share link copied.");
        } catch {
            setCopiedShareItemId(itemId);
            setShareCopyStatus("Could not copy automatically.");
        }

        if (shareCopyTimeoutRef.current) {
            window.clearTimeout(shareCopyTimeoutRef.current);
        }

        shareCopyTimeoutRef.current = window.setTimeout(() => {
            setCopiedShareItemId(null);
            setShareCopyStatus("");
            shareCopyTimeoutRef.current = null;
        }, 2400);
    };

    const setReportStatusMessage = (message, timeoutMs = 2600) => {
        setReportStatus(message);

        if (reportStatusTimeoutRef.current) {
            window.clearTimeout(reportStatusTimeoutRef.current);
        }

        reportStatusTimeoutRef.current = window.setTimeout(() => {
            setReportStatus("");
            reportStatusTimeoutRef.current = null;
        }, timeoutMs);
    };

    const showSaveResult = (itemId, status) => {
        setLastSaveResult({ itemId, status });
        if (saveResultTimeoutRef.current) {
            window.clearTimeout(saveResultTimeoutRef.current);
        }
        saveResultTimeoutRef.current = window.setTimeout(() => {
            setLastSaveResult(null);
            saveResultTimeoutRef.current = null;
        }, 2500);
    };

    const copyTextToClipboard = async (textValue) => {
        if (!textValue) return false;

        try {
            if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(textValue);
                return true;
            }

            const textArea = document.createElement("textarea");
            textArea.value = textValue;
            textArea.setAttribute("readonly", "");
            textArea.style.position = "absolute";
            textArea.style.left = "-9999px";
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
            return true;
        } catch {
            return false;
        }
    };

    const buildCurrentReportMessage = () => {
        if (!reportLocation) return "";

        const githubLogin = getGitHubLoginFromUser(currentUser);
        const reporterLabel = githubLogin
            ? `@${githubLogin}`
            : currentUser?.email || "Anonymous website visitor";

        return buildPublicReportMessage({
            latitude: reportLocation.y,
            longitude: reportLocation.x,
            note: reportNote,
            reporterLabel,
            sourceUrl: reportSourceUrl,
        });
    };

    const handleOpenMessengerForReport = () => {
        if (!reportLocation) return;
        if (!hasMessengerTarget || !messengerThreadUrl) {
            setReportStatusMessage("Messenger target is not configured yet.");
            return;
        }

        const now = Date.now();
        if (reportCooldownUntil > now) {
            setReportStatusMessage("Please wait a few seconds before sending another report.");
            return;
        }

        const message = buildCurrentReportMessage();
        const messengerUrl = `${messengerThreadUrl}?text=${encodeURIComponent(message)}`;

        // Attempt a synchronous execCommand copy BEFORE window.open so we still
        // hold the user-gesture token on Android Chrome (async clipboard API
        // will be denied after window.open consumes the gesture).
        let syncCopied = false;
        try {
            const ta = document.createElement("textarea");
            ta.value = message;
            ta.setAttribute("readonly", "");
            ta.style.cssText = "position:absolute;left:-9999px;top:-9999px;";
            document.body.appendChild(ta);
            ta.select();
            syncCopied = document.execCommand("copy");
            document.body.removeChild(ta);
        } catch (_) {
            // ignored — will fall through to async attempt below
        }

        // Must be synchronous (no async/await) so mobile browsers preserve the
        // user-gesture token and do not block window.open as a popup.
        window.open(messengerUrl, "_blank", "noopener,noreferrer");
        setReportCooldownUntil(Date.now() + REPORT_ACTION_COOLDOWN_MS);

        if (syncCopied) {
            setReportStatusMessage("Messenger opened. Report text copied to your clipboard.", 3600);
        } else {
            // Async clipboard as a second attempt (works on desktop/iOS Safari).
            copyTextToClipboard(message).then((copied) => {
                setReportStatusMessage(
                    copied
                        ? "Messenger opened. Report text copied to your clipboard."
                        : "Messenger opened. If the message box is empty, use the Copy button below and paste it in.",
                    3600,
                );
            }).catch(() => {
                setReportStatusMessage(
                    "Messenger opened. If the message box is empty, use the Copy button below and paste it in.",
                    3600,
                );
            });
        }
    };

    const handleOpenEmailForReport = () => {
        if (!reportLocation) return;
        if (!hasCommunityEmailTarget) {
            setReportStatusMessage("Community email is not configured yet.");
            return;
        }

        const now = Date.now();
        if (reportCooldownUntil > now) {
            setReportStatusMessage("Please wait a few seconds before sending another report.");
            return;
        }

        const message = buildCurrentReportMessage();
        const subject = "River Lune report from cleanup map";
        const mailtoUrl = `mailto:${encodeURIComponent(COMMUNITY_EMAIL_ACCOUNT)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;

        // Must be synchronous (no async/await) so mobile browsers preserve the
        // user-gesture token and do not suppress the mailto: navigation.
        window.location.href = mailtoUrl;
        setReportCooldownUntil(Date.now() + REPORT_ACTION_COOLDOWN_MS);

        // Clipboard copy is fire-and-forget; update status once settled.
        copyTextToClipboard(message).then((copied) => {
            setReportStatusMessage(
                copied
                    ? "Email draft opened with report details."
                    : "Email draft opened. If body is empty, paste details manually.",
                3600,
            );
        }).catch(() => {
            setReportStatusMessage("Email draft opened.", 3600);
        });
    };

    const markOverlayInteraction = () => {
        ignoreNextMapClickRef.current = true;

        window.setTimeout(() => {
            ignoreNextMapClickRef.current = false;
        }, 0);
    };

    const fetchLuneStations = async () => {
        try {
            const response = await fetch(EA_STATIONS_URL, { cache: "no-store" });

            if (!response.ok) {
                throw new Error("Could not load EA stations");
            }

            const payload = await response.json();
            const stationItems = Array.isArray(payload?.items) ? payload.items : [];
            const filteredStations = getUniqueEaStationsByKey(
                stationItems.filter((station) =>
                    isValidEaStationRecord(station, {
                        expectedRiverName: EA_TARGET_RIVER_NAME,
                        requirePrimaryMeasure: true,
                        preferredParameter: "level",
                    }) && isTrackedLuneStation(station),
                ),
            );

            setLuneStations(filteredStations);
            if (!filteredStations.length) {
                setLuneStationReadings({});
            }

            return filteredStations;
        } catch {
            setLuneStations([]);
            setLuneStationReadings({});
            return [];
        }
    };

    const fetchRegionalFlowStations = async () => {
        try {
            const response = await fetch(EA_REGIONAL_FLOW_STATIONS_URL, { cache: "no-store" });
            if (!response.ok) {
                throw new Error("Could not load regional flow stations");
            }

            const payload = await response.json();
            const stationItems = Array.isArray(payload?.items) ? payload.items : [];
            const filteredStations = getUniqueEaStationsByKey(
                stationItems.filter((station) =>
                    isValidEaStationRecord(station, {
                        requireFlowMeasure: true,
                        requirePrimaryMeasure: true,
                        preferredParameter: "flow",
                    }),
                ),
            );

            setRegionalFlowStations(filteredStations);
            if (!filteredStations.length) {
                setRegionalFlowReadings({});
            }

            return filteredStations;
        } catch {
            setRegionalFlowStations([]);
            setRegionalFlowReadings({});
            return [];
        }
    };

    const fetchStationReadings = async ({
        stations,
        setReadings,
        preferredParameter = "level",
        includeFlowSupplement = true,
    }) => {
        if (!Array.isArray(stations) || !stations.length) {
            setReadings({});
            return;
        }

        const stationKeys = stations.map((station) => getEaStationKey(station));

        setReadings((prev) => {
            const next = { ...prev };

            stationKeys.forEach((key) => {
                if (!key) return;
                next[key] = {
                    ...(next[key] || {}),
                    loading: true,
                    error: "",
                };
            });

            return next;
        });

        const updates = await Promise.all(
            stations.map(async (station) => {
                const key = getEaStationKey(station);
                if (!key) return null;

                const primaryMeasure = getEaPrimaryMeasure(station, preferredParameter);
                const primaryMeasureId = extractEaMeasureId(primaryMeasure?.["@id"]);
                const flowMeasure = includeFlowSupplement ? getEaMeasureByParameter(station, "flow") : null;
                const flowMeasureId = extractEaMeasureId(flowMeasure?.["@id"]);
                const shouldFetchFlow = Boolean(flowMeasureId && flowMeasureId !== primaryMeasureId);

                if (!primaryMeasureId) {
                    return {
                        key,
                        reading: buildEaEmptyReading({ primaryMeasure }),
                    };
                }

                try {
                    const [primarySnapshot, flowSnapshot] = await Promise.all([
                        fetchEaMeasureSnapshot(primaryMeasure),
                        shouldFetchFlow ? fetchEaMeasureSnapshot(flowMeasure) : Promise.resolve(null),
                    ]);

                    const parsedPrimary = primarySnapshot?.parsed;
                    const latest = parsedPrimary?.latest || null;
                    const previous = parsedPrimary?.previous || null;

                    let flowValue = null;
                    let flowDateTime = "";
                    let flowTrendDirection = "flat";
                    let flowTrendLabel = "";

                    if (flowSnapshot?.parsed?.latest) {
                        flowValue = flowSnapshot.parsed.latest.value ?? null;
                        flowDateTime = flowSnapshot.parsed.latest.dateTime || "";
                        flowTrendDirection = flowSnapshot.parsed.trend?.direction || "flat";
                        flowTrendLabel = flowSnapshot.parsed.trend?.label || "";
                    }

                    return {
                        key,
                        reading: {
                            loading: false,
                            error: primarySnapshot?.error || "",
                            value: latest?.value ?? null,
                            unitName: primaryMeasure?.unitName || "",
                            dateTime: latest?.dateTime || "",
                            parameterName: primaryMeasure?.parameterName || "",
                            previousValue: previous?.value ?? null,
                            previousUnitName: primaryMeasure?.unitName || "",
                            previousDateTime: previous?.dateTime || "",
                            previousAgeLabel: formatEaRelativeAge(previous?.dateTime || "") || "",
                            deltaValue: parsedPrimary?.deltaValue ?? null,
                            deltaDirection: parsedPrimary?.deltaDirection || "flat",
                            trendLabel: parsedPrimary?.trend?.label || "Trend unavailable",
                            trendDirection: parsedPrimary?.trend?.direction || "flat",
                            trendDeltaValue: parsedPrimary?.trend?.deltaValue ?? null,
                            recentReadings: parsedPrimary?.recentReadings || [],
                            flowValue,
                            flowUnitName: flowMeasure?.unitName || "",
                            flowDateTime,
                            flowTrendLabel,
                            flowTrendDirection,
                        },
                    };
                } catch {
                    return {
                        key,
                        reading: buildEaEmptyReading({ primaryMeasure, error: "Unavailable" }),
                    };
                }
            }),
        );

        setReadings((prev) => {
            const next = { ...prev };

            updates.forEach((update) => {
                if (!update?.key) return;
                next[update.key] = update.reading;
            });

            return next;
        });
    };

    const fetchLuneStationReadings = async (stations) => {
        await fetchStationReadings({
            stations,
            setReadings: setLuneStationReadings,
            preferredParameter: "level",
            includeFlowSupplement: true,
        });
    };

    const fetchRegionalFlowReadings = async (stations) => {
        await fetchStationReadings({
            stations,
            setReadings: setRegionalFlowReadings,
            preferredParameter: "flow",
            includeFlowSupplement: false,
        });
    };

    const fetchFloodAlerts = async () => {
        setIsLoadingFloodAlerts(true);
        setFloodAlertsError(null);
        try {
            const response = await fetch(EA_FLOODS_URL, { cache: "no-store" });
            if (!response.ok) {
                throw new Error("Could not load flood alerts");
            }
            const payload = await response.json();
            const rawItems = Array.isArray(payload?.items) ? payload.items : [];
            const shaped = rawItems
                .filter((item) => typeof item?.severityLevel === "number" && item.severityLevel <= 3)
                .map((item) => ({
                    id: item?.["@id"] || item?.floodAreaID || String(Math.random()),
                    severity: item?.severity || "Flood Alert",
                    severityLevel: item?.severityLevel ?? 3,
                    areaName: item?.eaAreaName || item?.floodAreaID || "Local area",
                    message: item?.message || item?.description || "",
                    timeIssued: formatEaReadingDateTime(item?.timeMessageIssued || item?.timeRaised || ""),
                }));
            shaped.sort((a, b) => a.severityLevel - b.severityLevel);
            setFloodAlerts(shaped);
            setFloodAlertsUpdatedAt(new Date().toLocaleTimeString("en-GB", { timeStyle: "short" }));
        } catch {
            setFloodAlertsError("unavailable");
            setFloodAlerts([]);
        } finally {
            setIsLoadingFloodAlerts(false);
        }
    };

    useEffect(() => {
        if (!isLiveLocationEnabled) {
            if (liveLocationWatchIdRef.current !== null && "geolocation" in navigator) {
                navigator.geolocation.clearWatch(liveLocationWatchIdRef.current);
                liveLocationWatchIdRef.current = null;
            }
            liveLocationBestRef.current = null;
            setLiveLocationError("");
            setLiveLocation(null);
            return undefined;
        }

        if (!("geolocation" in navigator)) {
            setLiveLocationError("Live location is not supported by this browser.");
            setIsLiveLocationEnabled(false);
            return undefined;
        }

        liveLocationBestRef.current = null;
        setLiveLocation(null);
        setLiveLocationError("Searching for a tighter GPS fix...");
        liveLocationWatchIdRef.current = navigator.geolocation.watchPosition(
            (position) => {
                const nextSample = buildLiveLocationSample(position);

                if (!nextSample) return;
                if (shouldReplaceLiveLocation(liveLocationBestRef.current, nextSample)) {
                    liveLocationBestRef.current = nextSample;
                    setLiveLocation(nextSample);
                }

                const bestSample = liveLocationBestRef.current;
                if (!bestSample) return;

                if (bestSample.accuracy !== null && bestSample.accuracy > 25) {
                    setLiveLocationError(
                        `GPS accuracy is still coarse (${Math.round(bestSample.accuracy)}m). Waiting for a better fix...`,
                    );
                    return;
                }

                setLiveLocationError("");
            },
            (error) => {
                if (error.code === error.PERMISSION_DENIED) {
                    setLiveLocation(null);
                }

                setLiveLocationError(getLiveLocationErrorMessage(error));
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 15000,
            },
        );

        return () => {
            if (liveLocationWatchIdRef.current !== null && "geolocation" in navigator) {
                navigator.geolocation.clearWatch(liveLocationWatchIdRef.current);
                liveLocationWatchIdRef.current = null;
            }
        };
    }, [isLiveLocationEnabled]);

    useEffect(() => {
        const cancelIdle = deferUntilIdle(() => {
            fetch("https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json")
                .then((r) => r.json())
                .then((data) => {
                    // The config is a plain object keyed by release number:
                    // { "10": { itemTitle: "World Imagery Wayback YYYY-MM-DD", snapshotId: 10, ... }, ... }
                    let list;
                    if (Array.isArray(data)) {
                        list = data;
                    } else {
                        list = Object.entries(data).map(([key, val]) => ({
                            releaseNum: Number(key),
                            releaseName: val.itemTitle || val.snapshotLabel || `Snapshot ${key}`,
                            ...val,
                        }));
                    }
                    // Sort most-recent first and keep the full release history available.
                    const sorted = [...list]
                        .filter((r) => r.releaseNum)
                        .sort((a, b) => {
                            const dateA = getWaybackReleaseDate(a);
                            const dateB = getWaybackReleaseDate(b);
                            return (dateB?.getTime() || 0) - (dateA?.getTime() || 0);
                        });
                    setWaybackReleases(sorted);
                    // Default to the latest World Imagery snapshot
                    if (sorted.length > 0) setSelectedWaybackId(sorted[0].releaseNum);
                })
                .catch(() => {});
        });

        return cancelIdle;
    }, []);

    useEffect(() => {
        void fetchItems();
        void fetchContributors();
        void fetchHistoricalPois();
    }, []);

    useEffect(() => {
        if (!authReady) return;
        void fetchHistoricOverlays();
    }, [authReady, currentUser?.id]);

    useEffect(() => {
        const cancelIdle = deferUntilIdle(() => {
            setIsDeferredUiReady(true);
        });

        return cancelIdle;
    }, []);

    useEffect(() => {
        const cancelIdle = deferUntilIdle(() => {
            void fetchLuneStations();
        });

        return cancelIdle;
    }, []);

    useEffect(() => {
        const cancelIdle = deferUntilIdle(() => {
            void fetchRegionalFlowStations();
        }, 3200);

        return cancelIdle;
    }, []);

    useEffect(() => {
        if (!luneStations.length) return undefined;

        void fetchLuneStationReadings(luneStations);
        const intervalId = window.setInterval(() => {
            void fetchLuneStationReadings(luneStations);
        }, EA_READINGS_REFRESH_MS);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [luneStations]);

    useEffect(() => {
        if (!regionalFlowStations.length) return undefined;

        void fetchRegionalFlowReadings(regionalFlowStations);
        const intervalId = window.setInterval(() => {
            void fetchRegionalFlowReadings(regionalFlowStations);
        }, EA_READINGS_REFRESH_MS);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [regionalFlowStations]);

    useEffect(() => {
        const cancelIdle = deferUntilIdle(() => {
            void fetchFloodAlerts();
        });

        const floodIntervalId = window.setInterval(() => {
            void fetchFloodAlerts();
        }, EA_READINGS_REFRESH_MS);

        return () => {
            cancelIdle();
            window.clearInterval(floodIntervalId);
        };
    }, []);

    useEffect(() => {
        let isMounted = true;

        if (!hasSupabaseConfig) {
            setCurrentUser(null);
            setAuthError("Supabase is not configured for this deployment.");
            setAuthReady(true);
            setIsAuthActionLoading(false);
            return () => {
                isMounted = false;
            };
        }

        const initAuth = async () => {
            const { data, error } = await supabase.auth.getUser();

            if (!isMounted) return;

            if (error) {
                setAuthError(getSupabaseAuthErrorMessage(error));
            }

            setCurrentUser(data?.user || null);
            setAuthReady(true);
            setIsAuthActionLoading(false);
        };

        initAuth();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
            setCurrentUser(session?.user || null);
            setAuthReady(true);
            setAuthError("");
            setIsAuthActionLoading(false);
        });

        return () => {
            isMounted = false;
            subscription.unsubscribe();
        };
    }, []);

    useEffect(() => {
        localStorage.setItem(ITEMS_STORAGE_KEY, JSON.stringify(items));
    }, [items]);

    useEffect(() => {
        localStorage.setItem(COUNT_STORAGE_KEY, JSON.stringify(localCounts));
    }, [localCounts]);

    useEffect(() => {
        localStorage.setItem(GPS_STORAGE_KEY, JSON.stringify(localGps));
    }, [localGps]);

    useEffect(() => {
        localStorage.setItem(WEIGHT_STORAGE_KEY, JSON.stringify(localWeights));
    }, [localWeights]);

    useEffect(() => {
        localStorage.setItem(GEOLOOKUP_STORAGE_KEY, JSON.stringify(localGeoLookup));
    }, [localGeoLookup]);

    useEffect(() => {
        localStorage.setItem(ITEM_STORY_STORAGE_KEY, JSON.stringify(localItemStory));
    }, [localItemStory]);

    useEffect(() => {
        localStorage.setItem(REPORT_CONSENT_STORAGE_KEY, JSON.stringify(hasAcceptedReportConsent));
    }, [hasAcceptedReportConsent]);

    useEffect(() => {
        if (!canManageItems || !authReady || !hasSupabaseConfig || !isHistoricOverlayDraftsHydrated) {
            return undefined;
        }

        const draftsToPersist = historicOverlayDrafts.filter((draft) => {
            if (!isHistoricOverlayDraftPersistable(draft)) return false;

            return serializeHistoricOverlayDraftForSync(draft)
                !== historicOverlayRemoteSnapshotsRef.current.get(draft.id);
        });
        if (!draftsToPersist.length) {
            return undefined;
        }

        setHistoricOverlaySyncStatus({
            kind: "saving",
            message: `Saving ${draftsToPersist.length === 1 ? "draft" : "drafts"} to Supabase...`,
        });

        const timerId = window.setTimeout(() => {
            void (async () => {
                try {
                    await upsertHistoricOverlayDrafts(draftsToPersist);
                    const nextRemoteSnapshots = new Map(historicOverlayRemoteSnapshotsRef.current);
                    draftsToPersist.forEach((draft) => {
                        nextRemoteSnapshots.set(draft.id, serializeHistoricOverlayDraftForSync(draft));
                    });
                    historicOverlayRemoteSnapshotsRef.current = nextRemoteSnapshots;
                    setHistoricOverlaySyncStatus({
                        kind: "saved",
                        message: `Historic overlay ${draftsToPersist.length === 1 ? "draft" : "drafts"} saved.`,
                    });
                    setHistoricOverlayLoadError("");
                } catch (error) {
                    setHistoricOverlaySyncStatus({
                        kind: "error",
                        message: error instanceof Error
                            ? error.message
                            : "Historic overlay draft save failed.",
                    });
                }
            })();
        }, HISTORIC_OVERLAY_AUTOSAVE_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timerId);
        };
    }, [
        authReady,
        canManageItems,
        hasSupabaseConfig,
        historicOverlayDrafts,
        isHistoricOverlayDraftsHydrated,
    ]);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(detectMobileViewport());
        };

        handleResize();
        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
        };
    }, []);

    useEffect(() => {
        if (!selectedItemId) return;

        const itemStillExists = items.some((item) => item.id === selectedItemId);
        if (!itemStillExists) {
            setSelectedItemId(null);
            setEditingItemId(null);
            setIsImageViewerOpen(false);
        }
    }, [items, selectedItemId]);

    useEffect(() => {
        return () => {
            if (shareCopyTimeoutRef.current) {
                window.clearTimeout(shareCopyTimeoutRef.current);
                shareCopyTimeoutRef.current = null;
            }

            if (reportStatusTimeoutRef.current) {
                window.clearTimeout(reportStatusTimeoutRef.current);
                reportStatusTimeoutRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!querySelectedItemId) return;
        if (!items.length) return;

        const matchedItem = items.find((item) => String(item.id) === querySelectedItemId);
        if (!matchedItem) return;

        setSelectedItemId(matchedItem.id);
        setQuerySelectedItemId(null);
    }, [items, querySelectedItemId]);

    useEffect(() => {
        if (!querySelectedPoiSlug) return;
        if (querySelectedItemId) return;
        if (!historicalPois.length) return;

        const matchedPoi = historicalPois.find(
            (poi) => normalizePoiSlug(poi?.slug) === querySelectedPoiSlug,
        );

        if (!matchedPoi?.id) {
            setQuerySelectedPoiSlug(null);
            return;
        }

        setSelectedHistoricalPoiId(matchedPoi.id);
        setIsPoiPanelOpen(false);
        setEditingHistoricalPoiId(null);
        setQuerySelectedPoiSlug(null);
    }, [historicalPois, querySelectedItemId, querySelectedPoiSlug]);

    useEffect(() => {
        if (canManageItems) return;

        setPendingLocation(null);
        setPendingItemType(null);
        setEditingItemId(null);
    }, [canManageItems]);

    useEffect(() => {
        if (!canManageItems) return;

        setReportLocation(null);
        setPendingReportLocation(null);
        setIsReportConsentOpen(false);
        setReportNote("");
        setReportStatus("");
    }, [canManageItems]);

    useEffect(() => {
        if (canUsePublicReports) return;

        setReportLocation(null);
        setPendingReportLocation(null);
        setIsReportConsentOpen(false);
        setReportNote("");
        setReportStatus("");
    }, [canUsePublicReports]);

    useEffect(() => {
        if (!pendingLocation && !reportLocation) return;
        setIsFilterSheetOpen(false);
        setIsMapToolsOpen(false);
    }, [pendingLocation, reportLocation]);

    useEffect(() => {
        const cancelIdle = deferUntilIdle(() => {
            void fetchLancasterTides();
        });

        return cancelIdle;
    }, []);

    async function fetchLancasterTides() {
        setIsLoadingLancasterTides(true);
        setLancasterTideError("");

        try {
            const response = await fetch(LANCASTER_TIDE_JSON_URL, { cache: "no-store" });

            if (!response.ok) {
                throw new Error("Could not load saved Lancaster tide times.");
            }

            const payload = await response.json();
            const nextRows = Array.isArray(payload.rows) ? payload.rows : [];

            if (!nextRows.length) {
                throw new Error("Saved Lancaster tide data is missing or empty.");
            }

            setLancasterTideRows(nextRows);
            setLancasterTideUpdatedAt(payload.updatedAt || "");
        } catch (error) {
            setLancasterTideRows([]);
            setLancasterTideUpdatedAt("");
            setLancasterTideError(error.message || "Could not load saved Lancaster tide times.");
        } finally {
            setIsLoadingLancasterTides(false);
        }
    }

    async function fetchCleanupForecast() {
        setIsLoadingCleanupForecast(true);
        setCleanupForecastError("");

        try {
            let response = null;

            for (let attemptIndex = 0; attemptIndex <= CLEANUP_FORECAST_RETRY_DELAYS_MS.length; attemptIndex += 1) {
                try {
                    response = await fetch(CLEANUP_FORECAST_URL, { cache: "no-store" });
                    if (!response.ok) {
                        throw new Error(`Forecast request failed with status ${response.status}`);
                    }
                    break;
                } catch (error) {
                    if (attemptIndex === CLEANUP_FORECAST_RETRY_DELAYS_MS.length) {
                        throw error;
                    }

                    await new Promise((resolve) => {
                        window.setTimeout(resolve, CLEANUP_FORECAST_RETRY_DELAYS_MS[attemptIndex]);
                    });
                }
            }

            const payload = await response.json();
            const nextForecast = buildCleanupForecast(payload);

            setCleanupForecast(nextForecast);
            setCleanupForecastUpdatedAt(new Date().toISOString());
            setCleanupForecastError("");
        } catch (error) {
            console.error("Cleanup forecast request failed", error);
            setCleanupForecastError("Weather forecast is temporarily unavailable.");
        } finally {
            setIsLoadingCleanupForecast(false);
        }
    }

    const getItemCounts = (item) => {
        const local = localCounts[item.id] || {};

        const totalFromDb =
            dbCountFieldSupport.total && item.total_count !== undefined
                ? item.total_count
                : undefined;
        const recoveredFromDb =
            dbCountFieldSupport.recovered && item.recovered_count !== undefined
                ? item.recovered_count
                : undefined;

        const total = Math.max(1, clampInt(totalFromDb ?? local.total ?? 1, 1));

        let recovered = clampInt(
            recoveredFromDb ??
                local.recovered ??
                (item.is_recovered ? total : 0),
            0,
        );
        recovered = Math.min(recovered, total);

        return {
            total,
            recovered,
            inWater: Math.max(total - recovered, 0),
            isRecovered: recovered >= total,
        };
    };

    const getItemGps = (item) => {
        const fromDbLatitude =
            dbGpsFieldSupport.latitude !== false && item.gps_latitude !== undefined
                ? parseGpsNumber(item.gps_latitude)
                : null;
        const fromDbLongitude =
            dbGpsFieldSupport.longitude !== false && item.gps_longitude !== undefined
                ? parseGpsNumber(item.gps_longitude)
                : null;

        if (fromDbLatitude !== null && fromDbLongitude !== null) {
            return {
                latitude: fromDbLatitude,
                longitude: fromDbLongitude,
                source: "map-selected",
            };
        }

        const fromLocal = localGps[item.id];
        if (!fromLocal) return null;

        const localLatitude = parseGpsNumber(fromLocal.latitude);
        const localLongitude = parseGpsNumber(fromLocal.longitude);

        if (localLatitude === null || localLongitude === null) return null;

        return {
            latitude: localLatitude,
            longitude: localLongitude,
            source: "map-selected",
        };
    };

    const getItemEstimatedWeight = (item) => {
        const fromDb =
            dbWeightFieldSupport !== false && item.estimated_weight_kg !== undefined
                ? parseEstimatedWeightKg(item.estimated_weight_kg)
                : null;

        if (fromDb !== null) {
            return {
                value: fromDb,
                source: "custom",
            };
        }

        const fromLocal = parseEstimatedWeightKg(localWeights[item.id]);
        if (fromLocal !== null) {
            return {
                value: fromLocal,
                source: "custom",
            };
        }

        return {
            value: getDefaultWeightForType(item.type),
            source: "default",
        };
    };

    const getItemGeoLookup = (item, gps) => {
        const dbLabel =
            dbGeoFieldSupport.label !== false && typeof item.geocode_label === "string"
                ? item.geocode_label.trim()
                : "";
        const dbPostcode =
            dbGeoFieldSupport.postcode !== false && typeof item.geocode_postcode === "string"
                ? item.geocode_postcode.trim()
                : "";
        const dbCountryCode =
            dbGeoFieldSupport.countryCode !== false && typeof item.geocode_country_code === "string"
                ? item.geocode_country_code.trim().toUpperCase()
                : "";
        const dbSource =
            dbGeoFieldSupport.source !== false && typeof item.geocode_source === "string"
                ? item.geocode_source.trim().toLowerCase()
                : "";

        if (dbLabel) {
            return {
                label: dbLabel,
                postcode: dbPostcode,
                countryCode: dbCountryCode || "GB",
                source: dbSource || "db",
            };
        }

        if (!gps) return null;

        const key = buildGpsLookupKey(gps.latitude, gps.longitude);
        return key ? localGeoLookup[key] || null : null;
    };

    const getItemStory = (item) => {
        const fromDbKnownSince =
            dbStoryFieldSupport.knownSinceDate !== false && item.known_since_date !== undefined
                ? normalizeOptionalDateInput(String(item.known_since_date || ""))
                : "";
        const fromDbRecoveredOn =
            dbStoryFieldSupport.recoveredOnDate !== false && item.recovered_on_date !== undefined
                ? normalizeOptionalDateInput(String(item.recovered_on_date || ""))
                : "";
        const fromDbReferenceImageUrl =
            dbStoryFieldSupport.referenceImageUrl !== false && typeof item.reference_image_url === "string"
                ? item.reference_image_url.trim()
                : "";
        const fromDbReferenceImageCaption =
            dbStoryFieldSupport.referenceImageCaption !== false && typeof item.reference_image_caption === "string"
                ? item.reference_image_caption.trim()
                : "";

        if (
            fromDbKnownSince ||
            fromDbRecoveredOn ||
            fromDbReferenceImageUrl ||
            fromDbReferenceImageCaption
        ) {
            return {
                knownSinceDate: fromDbKnownSince,
                recoveredOnDate: fromDbRecoveredOn,
                referenceImageUrl: fromDbReferenceImageUrl,
                referenceImageCaption: fromDbReferenceImageCaption,
            };
        }

        const fromLocal = localItemStory[item.id];
        if (!fromLocal || typeof fromLocal !== "object") return null;

        return {
            knownSinceDate: normalizeOptionalDateInput(fromLocal.knownSinceDate),
            recoveredOnDate: normalizeOptionalDateInput(fromLocal.recoveredOnDate),
            referenceImageUrl: typeof fromLocal.referenceImageUrl === "string" ? fromLocal.referenceImageUrl.trim() : "",
            referenceImageCaption:
                typeof fromLocal.referenceImageCaption === "string" ? fromLocal.referenceImageCaption.trim() : "",
        };
    };

    async function fetchItems({ bypassTtl = false } = {}) {
        setIsLoadingItems(true);

        if (!hasSupabaseConfig) {
            setIsLoadingItems(false);
            return false;
        }

        if (!bypassTtl) {
            const lastFetchTs = Number(localStorage.getItem(ITEMS_FETCH_TS_KEY) || 0);
            const cachedItems = readStoredJson(ITEMS_STORAGE_KEY, [], Array.isArray);
            if (Date.now() - lastFetchTs < CACHE_TTL_MS && cachedItems.length > 0) {
                setIsLoadingItems(false);
                return true;
            }
        }

        const { data, error } = await supabase.from("items").select("*");

        if (error) {
            setIsLoadingItems(false);
            return false;
        }

        const nextItems = data || [];
        setDbCountFieldSupport(inferDbCountFieldSupport(nextItems));
        setDbGpsFieldSupport(inferDbGpsFieldSupport(nextItems));
        setDbWeightFieldSupport(inferDbWeightFieldSupport(nextItems));
        setDbW3wFieldSupport(inferDbW3wFieldSupport(nextItems));
        setDbGeoFieldSupport(inferDbGeoFieldSupport(nextItems));
        setDbStoryFieldSupport(inferDbStoryFieldSupport(nextItems));
        setItems(nextItems);
        localStorage.setItem(ITEMS_FETCH_TS_KEY, String(Date.now()));
        setIsLoadingItems(false);
        return true;
    }

    async function fetchContributors({ bypassTtl = false } = {}) {
        if (!hasSupabaseConfig) {
            setContributors([]);
            return false;
        }

        if (!bypassTtl) {
            const lastFetchTs = Number(localStorage.getItem(CONTRIBUTORS_FETCH_TS_KEY) || 0);
            const cached = readStoredJson(CONTRIBUTORS_STORAGE_KEY, [], Array.isArray);
            if (Date.now() - lastFetchTs < CACHE_TTL_MS && cached.length > 0) {
                setContributors(cached);
                return true;
            }
        }

        const { data, error } = await supabase
            .from("contributors")
            .select("id, name, logo_url, website_url, description");

        if (error) {
            setContributors([]);
            return false;
        }

        const next = Array.isArray(data) ? data : [];
        setContributors(next);
        localStorage.setItem(CONTRIBUTORS_STORAGE_KEY, JSON.stringify(next));
        localStorage.setItem(CONTRIBUTORS_FETCH_TS_KEY, String(Date.now()));
        return true;
    }

    async function fetchHistoricalPois({ bypassTtl = false } = {}) {
        if (!hasSupabaseConfig) {
            setHistoricalPois([]);
            return false;
        }

        if (!bypassTtl) {
            const lastFetchTs = Number(localStorage.getItem(POIS_FETCH_TS_KEY) || 0);
            const cached = readStoredJson(POIS_STORAGE_KEY, [], Array.isArray);
            if (Date.now() - lastFetchTs < CACHE_TTL_MS && cached.length > 0) {
                setHistoricalPois(cached);
                return true;
            }
        }

        const { data, error } = await supabase
            .from("pois")
            .select(`
                *,
                poi_images (
                    id,
                    image_url,
                    alt_text,
                    caption,
                    display_order,
                    is_featured
                )
            `)
            .order("updated_at", { ascending: false });

        if (error) {
            setHistoricalPois([]);
            return false;
        }

        const normalized = Array.isArray(data)
            ? data.map((poi) => {
                const images = Array.isArray(poi.poi_images)
                    ? [...poi.poi_images].sort(
                        (left, right) =>
                            Number(left?.display_order || 0) - Number(right?.display_order || 0),
                    )
                    : [];

                return {
                    ...poi,
                    poi_images: images,
                };
            })
            : [];

        setHistoricalPois(normalized);
        localStorage.setItem(POIS_STORAGE_KEY, JSON.stringify(normalized));
        localStorage.setItem(POIS_FETCH_TS_KEY, String(Date.now()));
        return true;
    }

    async function fetchHistoricOverlays() {
        const localFallbackDrafts = Array.isArray(storedHistoricOverlayDrafts)
            ? storedHistoricOverlayDrafts
            : [];

        if (!hasSupabaseConfig) {
            setHistoricOverlayDrafts(buildHistoricOverlayDrafts(localFallbackDrafts));
            historicOverlayRemoteSnapshotsRef.current = buildHistoricOverlayDraftSnapshotMap(
                buildHistoricOverlayDrafts([]),
            );
            setHistoricOverlayLoadError("Historic overlay publishing requires Supabase configuration.");
            setIsHistoricOverlayDraftsHydrated(true);
            return false;
        }

        const { data, error } = await supabase
            .from("historic_overlays")
            .select("overlay_id, status, is_public, bounds, corners, control_points, editor_opacity, source_url, attribution, published_at, updated_at")
            .order("updated_at", { ascending: false });

        if (error) {
            setHistoricOverlayDrafts(buildHistoricOverlayDrafts(localFallbackDrafts));
            historicOverlayRemoteSnapshotsRef.current = buildHistoricOverlayDraftSnapshotMap(
                buildHistoricOverlayDrafts([]),
            );
            setHistoricOverlayLoadError(
                error.message || "Historic overlay drafts could not be loaded from Supabase.",
            );
            setHistoricOverlaySyncStatus({
                kind: "error",
                message: "Could not load shared historic overlay drafts from Supabase.",
            });
            setIsHistoricOverlayDraftsHydrated(true);
            return false;
        }

        const normalizedRemoteDrafts = Array.isArray(data)
            ? data.map(normalizeHistoricOverlaySourceRecord).filter(Boolean)
            : [];
        const mergedDrafts = buildHistoricOverlayDrafts(localFallbackDrafts, normalizedRemoteDrafts);

        setHistoricOverlayDrafts(mergedDrafts);
        historicOverlayRemoteSnapshotsRef.current = buildHistoricOverlayDraftSnapshotMap(
            buildHistoricOverlayDrafts([], normalizedRemoteDrafts),
        );
        setHistoricOverlayLoadError("");
        setHistoricOverlaySyncStatus((previous) => previous.kind === "error"
            ? { kind: "idle", message: "" }
            : previous);
        setIsHistoricOverlayDraftsHydrated(true);
        return true;
    }

    async function upsertHistoricOverlayDrafts(draftsToPersist) {
        if (!canManageItems) {
            throw new Error("Read-only account");
        }

        if (!hasSupabaseConfig) {
            throw new Error("Supabase is not configured for this deployment.");
        }

        const payload = (Array.isArray(draftsToPersist) ? draftsToPersist : [])
            .filter(Boolean)
            .filter(isHistoricOverlayDraftPersistable)
            .map(buildHistoricOverlayUpsertPayload);
        if (!payload.length) {
            return [];
        }

        const { error } = await supabase
            .from("historic_overlays")
            .upsert(payload, { onConflict: "overlay_id" });

        if (error) {
            throw new Error(error.message || "Historic overlay draft save failed.");
        }

        return payload;
    }

    async function publishHistoricOverlay(overlayId) {
        if (!overlayId || publishingHistoricOverlayId) return;

        const targetDraft = historicOverlayDrafts.find((draft) => draft.id === overlayId);
        if (!targetDraft) return;

        const nextPublishedAt = targetDraft.publishedAt || new Date().toISOString();
        const nextDraft = normalizeHistoricOverlayDraft(
            {
                ...targetDraft,
                status: HISTORIC_OVERLAY_STATUS_READY,
                isPublic: true,
                publishedAt: nextPublishedAt,
            },
            HISTORIC_OVERLAY_DRAFT_TEMPLATES.find((template) => template.id === overlayId),
        );

        setPublishingHistoricOverlayId(overlayId);
        setHistoricOverlaySyncStatus({
            kind: "publishing",
            message: `Publishing ${nextDraft.label}...`,
        });

        try {
            await upsertHistoricOverlayDrafts([nextDraft]);

            setHistoricOverlayDrafts((previousDrafts) => previousDrafts.map((draft) => (
                draft.id === overlayId
                    ? nextDraft
                    : draft
            )));
            historicOverlayRemoteSnapshotsRef.current.set(
                overlayId,
                serializeHistoricOverlayDraftForSync(nextDraft),
            );
            setSelectedHistoricOverlayId(overlayId);
            setIsHistoricOverlayEnabled(true);
            setHistoricOverlaySyncStatus({
                kind: "saved",
                message: `${nextDraft.label} is now public.`,
            });
            setHistoricOverlayLoadError("");
        } catch (error) {
            setHistoricOverlaySyncStatus({
                kind: "error",
                message: error instanceof Error
                    ? error.message
                    : "Historic overlay publish failed.",
            });
        } finally {
            setPublishingHistoricOverlayId("");
        }
    }

    const uploadHistoricalPoiImage = async (file) => {
        const sanitizedFile = await sanitizeImageFile(file);
        return uploadImage(sanitizedFile);
    };

    async function saveHistoricalPoi({
        poiId,
        title,
        slug,
        summary,
        description,
        latitude,
        longitude,
        period_start_year,
        period_end_year,
        is_historic,
        is_museum,
        google_maps_url,
        wiki_url,
        status,
        is_public,
        imageRows,
    }) {
        if (!canManageItems) {
            throw new Error("Read-only account");
        }

        const normalizedStatus =
            status === HISTORICAL_POI_STATUS_PUBLISHED
                ? HISTORICAL_POI_STATUS_PUBLISHED
                : HISTORICAL_POI_STATUS_DRAFT;
        const isPublished = normalizedStatus === HISTORICAL_POI_STATUS_PUBLISHED;

        const payload = {
            title,
            slug,
            summary: summary || null,
            description: description || null,
            latitude,
            longitude,
            period_start_year: Number.isFinite(period_start_year) ? period_start_year : null,
            period_end_year: Number.isFinite(period_end_year) ? period_end_year : null,
            is_historic: Boolean(is_historic),
            is_museum: Boolean(is_museum),
            google_maps_url: google_maps_url || null,
            wiki_url: wiki_url || null,
            status: normalizedStatus,
            is_public: Boolean(is_public && isPublished),
            published_at: null,
        };

        if (!poiId) {
            payload.published_at = isPublished ? new Date().toISOString() : null;
            payload.created_by = currentUser?.id || null;

            const { data, error } = await supabase
                .from("pois")
                .insert([payload])
                .select("id")
                .single();

            if (error || !data?.id) {
                throw new Error(error?.message || "Failed to create POI");
            }

            if (Array.isArray(imageRows) && imageRows.length > 0) {
                const imagePayload = imageRows.slice(0, 10).map((row, index) => ({
                    poi_id: data.id,
                    image_url: row.image_url,
                    alt_text: row.alt_text || null,
                    caption: row.caption || null,
                    display_order: index,
                    is_featured: index === 0,
                    uploaded_by: currentUser?.id || null,
                }));

                const { error: imageInsertError } = await supabase
                    .from("poi_images")
                    .insert(imagePayload);

                if (imageInsertError) {
                    throw new Error(imageInsertError.message || "POI created but image save failed");
                }
            }

            return;
        }

        const existingPoi = historicalPois.find((poi) => String(poi?.id) === String(poiId));
        payload.published_at = isPublished
            ? (existingPoi?.published_at || new Date().toISOString())
            : null;

        const { error: updateError } = await supabase
            .from("pois")
            .update(payload)
            .eq("id", poiId);

        if (updateError) {
            throw new Error(updateError?.message || "Failed to update POI");
        }

        if (Array.isArray(imageRows) && imageRows.length > 0) {
            const existingImages = Array.isArray(existingPoi?.poi_images)
                ? existingPoi.poi_images
                : [];
            const startOrder = existingImages.length;

            const imagePayload = imageRows.slice(0, 10).map((row, index) => ({
                poi_id: poiId,
                image_url: row.image_url,
                alt_text: row.alt_text || null,
                caption: row.caption || null,
                display_order: startOrder + index,
                is_featured: existingImages.length === 0 && index === 0,
                uploaded_by: currentUser?.id || null,
            }));

            const { error: imageInsertError } = await supabase
                .from("poi_images")
                .insert(imagePayload);

            if (imageInsertError) {
                throw new Error(imageInsertError.message || "POI updated but image save failed");
            }
        }
    }

    async function deleteHistoricalPoi(poiId) {
        if (!canManageItems) {
            throw new Error("Read-only account");
        }
        if (!poiId) {
            throw new Error("Missing POI id");
        }

        const { error } = await supabase
            .from("pois")
            .delete()
            .eq("id", poiId);

        if (error) {
            throw new Error(error?.message || "Failed to delete POI");
        }

        setSelectedHistoricalPoiId((prev) => (String(prev) === String(poiId) ? null : prev));
        setEditingHistoricalPoiId((prev) => (String(prev) === String(poiId) ? null : prev));
        setIsPoiPanelOpen(false);
    }

    async function saveGeoLookupForItem(itemId, geoLookup) {
        if (
            dbGeoFieldSupport.label === false ||
            dbGeoFieldSupport.postcode === false ||
            dbGeoFieldSupport.countryCode === false
        ) {
            return;
        }

        const payload = {
            geocode_label: geoLookup.label,
            geocode_postcode: geoLookup.postcode || null,
            geocode_country_code: geoLookup.countryCode || "GB",
            geocode_source: geoLookup.source || "nominatim",
            geocode_updated_at: new Date().toISOString(),
        };

        let { error } = await supabase
            .from("items")
            .update(payload)
            .eq("id", itemId);

        const geocodeColumnMissing =
            error &&
            (
                error.message?.toLowerCase().includes("geocode_label") ||
                error.message?.toLowerCase().includes("geocode_postcode") ||
                error.message?.toLowerCase().includes("geocode_country_code") ||
                error.message?.toLowerCase().includes("geocode_source") ||
                error.message?.toLowerCase().includes("geocode_updated_at")
            );

        if (geocodeColumnMissing) {
            setDbGeoFieldSupport({ label: false, postcode: false, countryCode: false });
            return;
        }

        if (!error) {
            setDbGeoFieldSupport((prev) => ({
                label: prev.label ?? true,
                postcode: prev.postcode ?? true,
                countryCode: prev.countryCode ?? true,
                source: prev.source ?? true,
            }));
        }
    }

    async function uploadImage(file) {
        const fileType = (file?.type || "").toLowerCase();
        const fileExt =
            getImageExtensionFromMimeType(fileType) ||
            (file?.name && file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "jpg");
        const fileName = `${Math.random().toString(36).slice(2)}.${fileExt}`;
        const filePath = `${fileName}`;

    // Upload the file to the Supabase Bucket
        const { error: uploadError } = await supabase.storage
            .from("debris-images")
            .upload(filePath, file, {
                contentType: file?.type || undefined,
            });

        if (uploadError) throw uploadError;

        // 2. Get the Public URL
        const { data } = supabase.storage
            .from("debris-images")
            .getPublicUrl(filePath);
        return data.publicUrl;
    }

    function uploadReferenceImageFromEdit() {
        if (!canManageItems) {
            alert("This account is read-only for now.");
            return;
        }

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        setUploadProgressText("Opening gallery...");

        let hasResolvedPicker = false;
        let fallbackTimerId = null;
        let focusTimerId = null;

        const releasePickerListeners = () => {
            window.removeEventListener("focus", handleWindowFocus);

            if (fallbackTimerId) {
                window.clearTimeout(fallbackTimerId);
                fallbackTimerId = null;
            }

            if (focusTimerId) {
                window.clearTimeout(focusTimerId);
                focusTimerId = null;
            }
        };

        const handleWindowFocus = () => {
            if (hasResolvedPicker) return;

            focusTimerId = window.setTimeout(() => {
                if (hasResolvedPicker) return;
                releasePickerListeners();
                setUploadProgressText((current) =>
                    current.startsWith("Opening ") ? "" : current,
                );
            }, 250);
        };

        const resolvePicker = () => {
            if (hasResolvedPicker) return;
            hasResolvedPicker = true;
            releasePickerListeners();
        };

        const handlePickerFailure = (message, clearAfterMs = 1800) => {
            resolvePicker();
            setUploadProgressText(message);
            window.setTimeout(() => setUploadProgressText(""), clearAfterMs);
        };

        window.addEventListener("focus", handleWindowFocus, { once: true });

        fallbackTimerId = window.setTimeout(() => {
            if (hasResolvedPicker) return;
            handlePickerFailure("Could not open gallery. Please try again.", 2200);
        }, 6000);

        input.onchange = async (event) => {
            resolvePicker();
            const file = event.target.files?.[0];

            if (!file) {
                setUploadProgressText("No image selected.");
                window.setTimeout(() => setUploadProgressText(""), 1500);
                return;
            }

            setIsUploadingReferenceImage(true);
            setUploadProgressText("Removing photo metadata...");

            try {
                const sanitizedFile = await sanitizeImageFile(file);
                setUploadProgressText("Uploading reference image...");
                const referenceImageUrl = await uploadImage(sanitizedFile);
                setEditForm((prev) => ({
                    ...prev,
                    referenceImageUrl,
                }));
                setUploadProgressText("Reference image uploaded.");
                window.setTimeout(() => setUploadProgressText(""), 1800);
            } catch {
                setUploadProgressText("Reference upload failed. Please try again.");
                alert("Reference upload failed. Please try again.");
            } finally {
                setIsUploadingReferenceImage(false);
            }
        };

        input.oncancel = () => {
            handlePickerFailure("No image selected.", 1500);
        };

        try {
            input.click();
        } catch {
            handlePickerFailure("Could not open gallery. Please try again.", 2200);
        }
    }

    async function signInWithGitHub() {
        setAuthError("");
        setIsAuthActionLoading(true);

        if (!hasSupabaseConfig) {
            setAuthError("Supabase is not configured for this deployment.");
            setIsAuthActionLoading(false);
            return;
        }

        const redirectTo = `${window.location.origin}${window.location.pathname}`;
        const { error } = await supabase.auth.signInWithOAuth({
            provider: "github",
            options: { redirectTo },
        });

        if (error) {
            setAuthError("GitHub sign-in failed. Please try again.");
            setIsAuthActionLoading(false);
            return;
        }
    }

    async function signOut() {
        setAuthError("");
        setIsAuthActionLoading(true);

        if (!hasSupabaseConfig) {
            setAuthError("Supabase is not configured for this deployment.");
            setIsAuthActionLoading(false);
            return;
        }

        const { error } = await supabase.auth.signOut();

        if (error) {
            setAuthError("Sign out failed. Please try again.");
        }

        setIsAuthActionLoading(false);
    }

    // Click handler to add new items to SQL
    function MapEvents() {
        useMapEvents({
            click: async (e) => {
                if (ignoreNextMapClickRef.current) {
                    ignoreNextMapClickRef.current = false;
                    return;
                }

                if (isSavingItem) return;

                if (canManageItems) {
                    setPendingItemType(null);
                    setPendingEstimatedWeight("");
                    setPendingLocation({
                        y: e.latlng.lat,
                        x: e.latlng.lng,
                    });
                    return;
                }

                if (!canUsePublicReports) return;

                const nextLocation = {
                    y: e.latlng.lat,
                    x: e.latlng.lng,
                };

                if (!hasAcceptedReportConsent) {
                    setPendingReportLocation(nextLocation);
                    setIsReportConsentOpen(true);
                    return;
                }

                setReportLocation(nextLocation);
                setReportStatus("");
            },
        });
        return null;
    }

    function MapInstanceBinder({ onMapReady }) {
        const map = useMap();

        useEffect(() => {
            onMapReady(map);

            return () => {
                onMapReady(null);
            };
        }, [map, onMapReady]);

        return null;
    }

    function LiveLocationPane({ onReady }) {
        const map = useMap();

        useEffect(() => {
            let pane = map.getPane(LIVE_LOCATION_PANE_NAME);

            if (!pane) {
                pane = map.createPane(LIVE_LOCATION_PANE_NAME);
            }

            pane.style.zIndex = String(LIVE_LOCATION_PANE_Z_INDEX);
            onReady(true);

            return () => {
                onReady(false);
            };
        }, [map, onReady]);

        return null;
    }

    function LiveLocationAutoCenter() {
        const map = useMap();
        const hasCenteredRef = useRef(false);

        useEffect(() => {
            if (!isLiveLocationEnabled) {
                hasCenteredRef.current = false;
                return;
            }

            if (!liveLocation || hasCenteredRef.current) return;

            // When radar is active, only pan to the user — don't fight its zoom constraint
            const targetZoom = isWeatherOverlayEnabled
                ? map.getZoom()
                : Math.max(map.getZoom(), 16);

            map.flyTo(
                [liveLocation.latitude, liveLocation.longitude],
                targetZoom,
                { duration: 0.8 },
            );
            hasCenteredRef.current = true;
        }, [map, liveLocation]);

        return null;
    }

    // Reset W3W words whenever the admin moves the pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        setPendingItemW3WWords(null);
        setPendingItemW3WLoading(false);
    }, [pendingLocation?.y, pendingLocation?.x]);

    async function handleFetchPendingW3W() {
        if (!pendingLocation || pendingItemW3WLoading || pendingItemW3WWords) return;
        const apiKey = (import.meta.env.VITE_W3W_API_KEY || "").trim();
        if (!apiKey) return;
        setPendingItemW3WLoading(true);
        try {
            const url =
                `https://api.what3words.com/v3/convert-to-3wa` +
                `?coordinates=${encodeURIComponent(`${pendingLocation.y},${pendingLocation.x}`)}` +
                `&language=en&format=json` +
                `&key=${encodeURIComponent(apiKey)}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`W3W ${res.status}`);
            const data = await res.json();
            const words = data?.words ?? null;
            setPendingItemW3WWords(words);
        } catch {
            // silently fail — W3W is optional
        } finally {
            setPendingItemW3WLoading(false);
        }
    }

    async function handleTypePick(selectedType, imageSource = "gallery") {
        if (!canManageItems) {
            alert("This account is read-only for now.");
            return;
        }

        if (!pendingLocation || isSavingItem || isPickingImage) return;

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        if (imageSource === "camera") {
            input.capture = "environment";
        }

        const point = pendingLocation;
        const openingMessage = imageSource === "camera" ? "Opening camera..." : "Opening gallery...";
        const launchFailureMessage = imageSource === "camera"
            ? "Could not open camera. Please try again."
            : "Could not open gallery. Please try again.";

        setUploadProgressText(openingMessage);
        setIsPickingImage(true);

        let hasResolvedPicker = false;
        let fallbackTimerId = null;
        let focusTimerId = null;

        const releasePickerListeners = () => {
            window.removeEventListener("focus", handleWindowFocus);

            if (fallbackTimerId) {
                window.clearTimeout(fallbackTimerId);
                fallbackTimerId = null;
            }

            if (focusTimerId) {
                window.clearTimeout(focusTimerId);
                focusTimerId = null;
            }
        };

        const unlockPickerState = () => {
            setIsPickingImage(false);
        };

        const handleWindowFocus = () => {
            if (hasResolvedPicker) return;

            focusTimerId = window.setTimeout(() => {
                if (hasResolvedPicker) return;
                releasePickerListeners();
                unlockPickerState();
                setUploadProgressText((current) =>
                    current.startsWith("Opening ") ? "" : current,
                );
            }, 250);
        };

        const resolvePicker = () => {
            if (hasResolvedPicker) return;
            hasResolvedPicker = true;
            releasePickerListeners();
            unlockPickerState();
        };

        const handlePickerFailure = (message, clearAfterMs = 2200) => {
            resolvePicker();
            setUploadProgressText(message);
            if (clearAfterMs > 0) {
                window.setTimeout(() => setUploadProgressText(""), clearAfterMs);
            }
        };

        window.addEventListener("focus", handleWindowFocus, { once: true });

        fallbackTimerId = window.setTimeout(() => {
            if (hasResolvedPicker) return;
            handlePickerFailure(launchFailureMessage);
        }, 6000);

        input.onchange = async (event) => {
            const file = event.target.files?.[0];
            const estimatedWeightKg = parseEstimatedWeightKg(pendingEstimatedWeight) || getDefaultWeightForType(selectedType);
            let saveSucceeded = false;
            resolvePicker();

            if (!file) {
                setUploadProgressText("No image selected.");
                window.setTimeout(() => setUploadProgressText(""), 1500);
                return;
            }

            setIsSavingItem(true);
            setUploadProgressText("Removing photo metadata...");

            try {
                const sanitizedFile = await sanitizeImageFile(file);
                setUploadProgressText("Uploading photo...");
                const imageUrl = await uploadImage(sanitizedFile);
                let gpsSavedToDb = false;
                let weightSavedToDb = false;
                const gpsSource = { latitude: point.y, longitude: point.x };

                const insertPayload = {
                    y: point.y,
                    x: point.x,
                    type: selectedType,
                    image_url: imageUrl,
                    is_recovered: false,
                };

                if (currentUser?.id) insertPayload.created_by = currentUser.id;

                if (dbCountFieldSupport.total) insertPayload.total_count = pendingCount;
                if (dbCountFieldSupport.recovered) insertPayload.recovered_count = 0;
                if (dbWeightFieldSupport !== false) insertPayload.estimated_weight_kg = estimatedWeightKg;
                if (
                    dbGpsFieldSupport.latitude !== false &&
                    dbGpsFieldSupport.longitude !== false
                ) {
                    insertPayload.gps_latitude = gpsSource.latitude;
                    insertPayload.gps_longitude = gpsSource.longitude;
                }
                if (dbW3wFieldSupport !== false && pendingItemW3WWordsRef.current) {
                    insertPayload.w3w_address = pendingItemW3WWordsRef.current;
                }

                let { data, error } = await supabase
                    .from("items")
                    .insert([insertPayload])
                    .select("id")
                    .single();

                const gpsColumnMissing =
                    error &&
                    (error.message?.toLowerCase().includes("gps_latitude") ||
                        error.message?.toLowerCase().includes("gps_longitude"));
                const weightColumnMissing =
                    error && error.message?.toLowerCase().includes("estimated_weight_kg");
                const createdByColumnMissing =
                    error && error.message?.toLowerCase().includes("created_by");
                const w3wColumnMissing =
                    error && error.message?.toLowerCase().includes("w3w_address");

                if (gpsColumnMissing || weightColumnMissing || createdByColumnMissing || w3wColumnMissing) {
                    const retryPayload = { ...insertPayload };
                    if (gpsColumnMissing) {
                        delete retryPayload.gps_latitude;
                        delete retryPayload.gps_longitude;
                        setDbGpsFieldSupport({ latitude: false, longitude: false });
                    }
                    if (weightColumnMissing) {
                        delete retryPayload.estimated_weight_kg;
                        setDbWeightFieldSupport(false);
                    }
                    if (createdByColumnMissing) {
                        delete retryPayload.created_by;
                    }
                    if (w3wColumnMissing) {
                        delete retryPayload.w3w_address;
                        setDbW3wFieldSupport(false);
                    }

                    const retryResult = await supabase
                        .from("items")
                        .insert([retryPayload])
                        .select("id")
                        .single();

                    data = retryResult.data;
                    error = retryResult.error;
                } else if (!error) {
                    gpsSavedToDb = true;
                    weightSavedToDb = true;
                    setDbGpsFieldSupport((prev) => ({
                        latitude: prev.latitude ?? true,
                        longitude: prev.longitude ?? true,
                    }));
                    setDbWeightFieldSupport((prev) => prev ?? true);
                }

                if (error) {
                    setUploadProgressText("Could not save item. Please try again.");
                    alert("Could not save item. Please try again.");
                    return;
                }

                if (!dbCountFieldSupport.total && data?.id) {
                    setLocalCounts((prev) => ({
                        ...prev,
                        [data.id]: { total: pendingCount, recovered: 0 },
                    }));
                }

                if (data?.id && !gpsSavedToDb) {
                    setLocalGps((prev) => ({
                        ...prev,
                        [data.id]: {
                            latitude: gpsSource.latitude,
                            longitude: gpsSource.longitude,
                        },
                    }));
                }

                if (data?.id && !weightSavedToDb) {
                    setLocalWeights((prev) => ({
                        ...prev,
                        [data.id]: estimatedWeightKg,
                    }));
                }

                setUploadProgressText("Saved. Refreshing map...");
                await fetchItems({ bypassTtl: true });
                saveSucceeded = true;
                setUploadProgressText("");
            } catch {
                setUploadProgressText("Upload failed. Please try again.");
                alert("Upload failed. Please try again.");
            } finally {
                setIsSavingItem(false);
                resolvePicker();

                if (saveSucceeded) {
                    setPendingItemType(null);
                    setPendingLocation(null);
                    setPendingEstimatedWeight("");
                    setPendingCount(1);
                }
            }
        };

        input.oncancel = () => {
            handlePickerFailure("No image selected.", 1500);
        };

        try {
            input.click();
        } catch {
            handlePickerFailure(launchFailureMessage);
        }
    }

    function startEditingItem(item) {
        if (!canManageItems) {
            alert("This account is read-only for now.");
            return;
        }

        const counts = getItemCounts(item);

        const gps = getItemGps(item);
        const estimatedWeight = getItemEstimatedWeight(item);
        const story = getItemStory(item);
        setEditingItemId(item.id);
        setEditForm({
            type: normalizeType(item.type),
            total: counts.total,
            recovered: counts.recovered,
            estimatedWeight: String(estimatedWeight.value),
            lat: gps ? String(gps.latitude) : "",
            lng: gps ? String(gps.longitude) : "",
            knownSinceDate: normalizeOptionalDateInput(story?.knownSinceDate),
            recoveredOnDate: normalizeOptionalDateInput(story?.recoveredOnDate),
            referenceImageUrl: story?.referenceImageUrl || "",
            referenceImageCaption: story?.referenceImageCaption || "",
        });
    }

    async function saveItemEdits(itemId) {
        if (!canManageItems) {
            alert("This account is read-only for now.");
            return;
        }

        const total = Math.max(1, clampInt(editForm.total, 1));
        const recovered = Math.min(total, clampInt(editForm.recovered, 0));
        const nextType = normalizeType(editForm.type);
        const estimatedWeightKg = parseEstimatedWeightKg(editForm.estimatedWeight) || getDefaultWeightForType(nextType);
        const nextRecoveredState = recovered >= total;
        const knownSinceDate = normalizeOptionalDateInput(editForm.knownSinceDate);
        const recoveredOnDate = normalizeOptionalDateInput(editForm.recoveredOnDate);
        const referenceImageUrl = (editForm.referenceImageUrl || "").trim();
        const referenceImageCaption = (editForm.referenceImageCaption || "").trim();

        const updatePayload = {
            type: nextType,
            is_recovered: nextRecoveredState,
        };

        if (dbCountFieldSupport.total) updatePayload.total_count = total;
        if (dbCountFieldSupport.recovered) updatePayload.recovered_count = recovered;
        if (dbWeightFieldSupport !== false) updatePayload.estimated_weight_kg = estimatedWeightKg;
        if (dbStoryFieldSupport.knownSinceDate !== false) updatePayload.known_since_date = knownSinceDate || null;
        if (dbStoryFieldSupport.recoveredOnDate !== false) updatePayload.recovered_on_date = recoveredOnDate || null;
        if (dbStoryFieldSupport.referenceImageUrl !== false) updatePayload.reference_image_url = referenceImageUrl || null;
        if (dbStoryFieldSupport.referenceImageCaption !== false) updatePayload.reference_image_caption = referenceImageCaption || null;

        const parsedLat = parseGpsNumber(editForm.lat);
        const parsedLng = parseGpsNumber(editForm.lng);
        const hasValidGps =
            parsedLat !== null && parsedLng !== null &&
            parsedLat >= -90 && parsedLat <= 90 &&
            parsedLng >= -180 && parsedLng <= 180;

        if (hasValidGps) {
            if (dbGpsFieldSupport.latitude !== false) updatePayload.gps_latitude = parsedLat;
            if (dbGpsFieldSupport.longitude !== false) updatePayload.gps_longitude = parsedLng;
        }

        setIsUpdatingItemId(itemId);

        let { error } = await supabase
            .from("items")
            .update(updatePayload)
            .eq("id", itemId);

        const gpsColumnMissing =
            error &&
            (error.message?.toLowerCase().includes("gps_latitude") ||
                error.message?.toLowerCase().includes("gps_longitude"));
        const weightColumnMissing =
            error && error.message?.toLowerCase().includes("estimated_weight_kg");
        const storyColumnMissing =
            error &&
            (
                error.message?.toLowerCase().includes("known_since_date") ||
                error.message?.toLowerCase().includes("recovered_on_date") ||
                error.message?.toLowerCase().includes("reference_image_url") ||
                error.message?.toLowerCase().includes("reference_image_caption")
            );

        if (gpsColumnMissing || weightColumnMissing || storyColumnMissing) {
            const retryPayload = { ...updatePayload };

            if (gpsColumnMissing) {
                delete retryPayload.gps_latitude;
                delete retryPayload.gps_longitude;
                setDbGpsFieldSupport({ latitude: false, longitude: false });
            }

            if (weightColumnMissing) {
                delete retryPayload.estimated_weight_kg;
                setDbWeightFieldSupport(false);
            }

            if (storyColumnMissing) {
                delete retryPayload.known_since_date;
                delete retryPayload.recovered_on_date;
                delete retryPayload.reference_image_url;
                delete retryPayload.reference_image_caption;
                setDbStoryFieldSupport({
                    knownSinceDate: false,
                    recoveredOnDate: false,
                    referenceImageUrl: false,
                    referenceImageCaption: false,
                });
            }

            const retryResult = await supabase
                .from("items")
                .update(retryPayload)
                .eq("id", itemId);

            error = retryResult.error;
        }

        if (error) {
            showSaveResult(itemId, "error");
            setIsUpdatingItemId(null);
            return;
        }

        if (!dbCountFieldSupport.total) {
            setLocalCounts((prev) => ({
                ...prev,
                [itemId]: { total, recovered },
            }));
        }

        if (hasValidGps && dbGpsFieldSupport.latitude === false) {
            setLocalGps((prev) => ({
                ...prev,
                [itemId]: { latitude: parsedLat, longitude: parsedLng },
            }));
        }

        if (dbWeightFieldSupport === false || weightColumnMissing) {
            setLocalWeights((prev) => ({
                ...prev,
                [itemId]: estimatedWeightKg,
            }));
        }

        if (
            dbStoryFieldSupport.knownSinceDate === false ||
            dbStoryFieldSupport.recoveredOnDate === false ||
            dbStoryFieldSupport.referenceImageUrl === false ||
            dbStoryFieldSupport.referenceImageCaption === false ||
            storyColumnMissing
        ) {
            setLocalItemStory((prev) => {
                const next = { ...prev };
                const nextStory = {
                    knownSinceDate,
                    recoveredOnDate,
                    referenceImageUrl,
                    referenceImageCaption,
                };

                if (isItemStoryEmpty(nextStory)) {
                    delete next[itemId];
                } else {
                    next[itemId] = nextStory;
                }

                return next;
            });
        } else {
            setLocalItemStory((prev) => {
                if (!Object.prototype.hasOwnProperty.call(prev, itemId)) return prev;

                const next = { ...prev };
                delete next[itemId];
                return next;
            });
        }

        showSaveResult(itemId, "success");
        setEditingItemId(null);
        setIsUpdatingItemId(null);
        fetchItems({ bypassTtl: true });
    }

    async function markItemRecovered(itemId) {
        if (!canManageItems) return;

        const item = items.find((i) => String(i?.id) === String(itemId));
        if (!item) return;

        setIsUpdatingItemId(itemId);

        const total = Math.max(1, clampInt(item.total_count ?? 1, 1));
        const updatePayload = { is_recovered: true };
        if (dbCountFieldSupport.recovered) updatePayload.recovered_count = total;

        const { error } = await supabase
            .from("items")
            .update(updatePayload)
            .eq("id", itemId);

        if (error) {
            showSaveResult(itemId, "error");
            setIsUpdatingItemId(null);
            return;
        }

        if (!dbCountFieldSupport.total) {
            setLocalCounts((prev) => ({
                ...prev,
                [itemId]: { total, recovered: total },
            }));
        }

        showSaveResult(itemId, "recovered");
        setIsUpdatingItemId(null);
        fetchItems({ bypassTtl: true });
    }

    async function removeLocation(itemId) {
        if (!canManageItems) {
            alert("This account is read-only for now.");
            return;
        }

        if (!hasSupabaseConfig) {
            alert("Supabase is not configured for this deployment.");
            return;
        }

        const confirmed = window.confirm("Remove this location and all its item data?");
        if (!confirmed) return;

        setIsUpdatingItemId(itemId);

        const itemToDelete = items.find((item) => String(item?.id) === String(itemId)) || null;
        const { data: authData, error: authError } = await supabase.auth.getUser();
        const authUser = authData?.user || null;

        if (authError || !authUser) {
            console.error("Could not verify Supabase user before delete", {
                itemId,
                authError,
                currentUserId: currentUser?.id || null,
            });
            alert(authError ? getSupabaseAuthErrorMessage(authError) : "Please sign in again before deleting this location.");
            setIsUpdatingItemId(null);
            return;
        }

        const { data, error } = await supabase
            .from("items")
            .delete()
            .eq("id", itemId)
            .select("id");

        const deletedItem = Array.isArray(data)
            ? data.find((row) => String(row?.id) === String(itemId))
            : null;
        let deleteConfirmed = Boolean(deletedItem);
        let postDeleteLookupError = null;
        let postDeleteRowStillExists = false;

        if (!error && !deleteConfirmed) {
            const { data: existingRow, error: lookupError } = await supabase
                .from("items")
                .select("id")
                .eq("id", itemId)
                .maybeSingle();

            postDeleteLookupError = lookupError;
            postDeleteRowStillExists = Boolean(existingRow?.id);
            deleteConfirmed = !postDeleteRowStillExists && !lookupError;
        }

        if (error || !deleteConfirmed) {
            const itemOwnerId = typeof itemToDelete?.created_by === "string"
                ? itemToDelete.created_by.trim()
                : "";
            const hasCreatedByField = Boolean(itemToDelete) && Object.prototype.hasOwnProperty.call(itemToDelete, "created_by");
            const isLegacyOwnerlessItem = hasCreatedByField && !itemOwnerId;
            const belongsToDifferentUser = Boolean(itemOwnerId && itemOwnerId !== authUser.id);
            const sessionMismatch = Boolean(currentUser?.id && currentUser.id !== authUser.id);

            console.error("Could not delete cleanup item", {
                itemId,
                error,
                deletedRowCount: Array.isArray(data) ? data.length : 0,
                currentUserId: currentUser?.id || null,
                authUserId: authUser.id,
                itemCreatedBy: itemOwnerId || null,
                postDeleteLookupError,
                postDeleteRowStillExists,
            });

            if (sessionMismatch) {
                alert("Your local sign-in state does not match the active Supabase session. Sign out and sign back in, then try again.");
            } else if (belongsToDifferentUser) {
                alert("This location belongs to a different Supabase account and cannot be deleted from this sign-in.");
            } else if (isLegacyOwnerlessItem) {
                alert("This location has no owner stored in Supabase, so the current delete policy blocks it. It needs a database backfill or policy change.");
            } else {
                alert("Could not delete this location.");
            }

            setIsUpdatingItemId(null);
            return;
        }

        setItems((prev) => prev.filter((item) => item.id !== itemId));

        setLocalCounts((prev) => {
            if (!prev[itemId]) return prev;

            const next = { ...prev };
            delete next[itemId];
            return next;
        });

        setLocalGps((prev) => {
            if (!prev[itemId]) return prev;

            const next = { ...prev };
            delete next[itemId];
            return next;
        });

        setLocalWeights((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, itemId)) return prev;

            const next = { ...prev };
            delete next[itemId];
            return next;
        });

        setLocalItemStory((prev) => {
            if (!Object.prototype.hasOwnProperty.call(prev, itemId)) return prev;

            const next = { ...prev };
            delete next[itemId];
            return next;
        });

        if (editingItemId === itemId) {
            setEditingItemId(null);
        }

        if (selectedItemId === itemId) {
            setSelectedItemId(null);
            setIsImageViewerOpen(false);
        }

        await fetchItems({ bypassTtl: true });
        setIsUpdatingItemId(null);
    }

    const filteredItems = useMemo(() => items.filter((item) => {
        const itemType = normalizeType(item.type);
        const counts = getItemCounts(item);

        const matchesType =
            typeFilter === "all" ? true : itemType === typeFilter;
        const matchesStatus =
            statusFilter === "all"
                ? true
                : statusFilter === "recovered"
                  ? counts.isRecovered
                  : counts.inWater > 0;

        return matchesType && matchesStatus;
    }), [items, typeFilter, statusFilter, localCounts, dbCountFieldSupport]);

    const totals = useMemo(() => filteredItems.reduce(
        (acc, item) => {
            const counts = getItemCounts(item);
            acc.total += counts.total;
            acc.recovered += counts.recovered;
            acc.remaining += counts.inWater;
            return acc;
        },
        { total: 0, recovered: 0, remaining: 0 },
    ), [filteredItems, localCounts, dbCountFieldSupport]);

    const impactStats = useMemo(() => {
        const baseStats = filteredItems.reduce(
        (acc, item) => {
            const counts = getItemCounts(item);
            const type = normalizeType(item.type);
            const estimatedWeight = getItemEstimatedWeight(item).value;

            acc.totalByType[type] += counts.total;
            acc.estimatedRecoveredKg += counts.recovered * estimatedWeight;
            acc.estimatedRemainingKg += counts.inWater * estimatedWeight;
            acc.recoveredByType[type] += counts.recovered;
            acc.remainingByType[type] += counts.inWater;
            acc.totalWeightByType[type] += counts.total * estimatedWeight;
            acc.recoveredWeightByType[type] += counts.recovered * estimatedWeight;
            acc.remainingWeightByType[type] += counts.inWater * estimatedWeight;
            return acc;
        },
        {
            totalByType: { trolley: 0, bike: 0, historic: 0, motorbike: 0, misc: 0 },
            estimatedRecoveredKg: 0,
            estimatedRemainingKg: 0,
            recoveredByType: { trolley: 0, bike: 0, historic: 0, motorbike: 0, misc: 0 },
            remainingByType: { trolley: 0, bike: 0, historic: 0, motorbike: 0, misc: 0 },
            totalWeightByType: { trolley: 0, bike: 0, historic: 0, motorbike: 0, misc: 0 },
            recoveredWeightByType: { trolley: 0, bike: 0, historic: 0, motorbike: 0, misc: 0 },
            remainingWeightByType: { trolley: 0, bike: 0, historic: 0, motorbike: 0, misc: 0 },
        },
    );

        return baseStats;
    }, [filteredItems, localCounts, dbCountFieldSupport, localWeights, dbWeightFieldSupport]);

    const tideChartData = useMemo(
        () => buildTideChartData(lancasterTideRows, lancasterTideUpdatedAt),
        [lancasterTideRows, lancasterTideUpdatedAt],
    );
    const luneStationKeySet = useMemo(
        () => new Set(luneStations.map((station) => getEaStationKey(station)).filter(Boolean)),
        [luneStations],
    );
    const cleanupPlannerSensors = useMemo(() => {
        const toPlannerRow = (station, reading, kind) => {
            const stationKey = getEaStationKey(station);
            if (!stationKey) return null;

            const numericValue = Number(reading?.value);
            const hasValue = Number.isFinite(numericValue);
            const parameterName = reading?.parameterName
                || getEaPrimaryMeasure(station, kind === "regional-flow" ? "flow" : "level")?.parameterName
                || "Latest reading";
            const flowValue = Number(reading?.flowValue);
            const hasFlowValue = Number.isFinite(flowValue);

            return {
                id: `${kind}:${stationKey}`,
                stationKey,
                name: station?.label || stationKey,
                riverName: station?.riverName || "River Lune",
                kind,
                sensorType: kind,
                kindLabel: kind === "regional-flow" ? "Regional flow" : "River sensor",
                parameterName,
                loading: Boolean(reading?.loading),
                error: reading?.error || "",
                valueLabel: hasValue
                    ? `${numericValue.toLocaleString(undefined, { maximumFractionDigits: 3 })}${reading?.unitName ? ` ${reading.unitName}` : ""}`
                    : "Reading unavailable",
                timestampLabel: formatEaReadingDateTime(reading?.dateTime) || "",
                ageLabel: formatEaRelativeAge(reading?.dateTime || "") || "",
                trendLabel: reading?.trendLabel || "Trend unavailable",
                trendDirection: reading?.trendDirection || "flat",
                flowLabel: hasFlowValue
                    ? `${flowValue.toLocaleString(undefined, { maximumFractionDigits: 3 })}${reading?.flowUnitName ? ` ${reading.flowUnitName}` : ""}`
                    : "",
                flowTimestampLabel: formatEaReadingDateTime(reading?.flowDateTime) || "",
                history: Array.isArray(reading?.recentReadings)
                    ? reading.recentReadings.slice(0, 24).map((entry, index) => ({
                        id: `${stationKey}-${entry?.dateTime || index}`,
                        valueLabel: Number(entry?.value).toLocaleString(undefined, { maximumFractionDigits: 3 })
                            + (reading?.unitName ? ` ${reading.unitName}` : ""),
                        ageLabel: entry?.ageLabel || formatEaRelativeAge(entry?.dateTime || "") || "",
                        timestampLabel: formatEaReadingDateTime(entry?.dateTime || "") || "",
                    }))
                    : [],
            };
        };

        const luneRows = luneStations.map((station) =>
            toPlannerRow(station, luneStationReadings[getEaStationKey(station)], "lune"),
        );
        const regionalRows = regionalFlowStations
            .filter((station) => {
                const stationKey = getEaStationKey(station);
                return stationKey && !luneStationKeySet.has(stationKey);
            })
            .map((station) =>
                toPlannerRow(station, regionalFlowReadings[getEaStationKey(station)], "regional-flow"),
            );

        return [...luneRows, ...regionalRows]
            .filter(Boolean)
            .filter((row) => Array.isArray(row.history) && row.history.length > 0)
            .sort((left, right) => left.name.localeCompare(right.name));
    }, [
        luneStationKeySet,
        luneStationReadings,
        luneStations,
        regionalFlowReadings,
        regionalFlowStations,
    ]);
    const cleanupForecastUpdatedLabel = useMemo(() => {
        if (!cleanupForecastUpdatedAt) return "";

        const parsed = new Date(cleanupForecastUpdatedAt);
        if (Number.isNaN(parsed.getTime())) return "";

        return parsed.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
        });
    }, [cleanupForecastUpdatedAt]);

    const mobileStatsSummary = useMemo(
        () => `${totals.total} total • ${totals.recovered} out • ${totals.remaining} left • ${filteredItems.length} places`,
        [filteredItems.length, totals.recovered, totals.remaining, totals.total],
    );

    useEffect(() => {
        if (!isMobile && isMobileStatsExpanded) {
            setIsMobileStatsExpanded(false);
        }
    }, [isMobile, isMobileStatsExpanded]);

    useLayoutEffect(() => {
        if (!isMobile) {
            setMobileStickyStackHeight(0);
            return undefined;
        }

        const node = stickyTopStackRef.current;
        if (!node) return undefined;

        const updateHeight = () => {
            setMobileStickyStackHeight(Math.ceil(node.getBoundingClientRect().height));
        };

        updateHeight();

        if (typeof ResizeObserver === "undefined") {
            window.addEventListener("resize", updateHeight);
            return () => window.removeEventListener("resize", updateHeight);
        }

        const observer = new ResizeObserver(() => {
            updateHeight();
        });
        observer.observe(node);

        return () => observer.disconnect();
    }, [isMobile, isMobileStatsExpanded]);

    const mobileStickyOffset = mobileStickyStackHeight > 0
        ? mobileStickyStackHeight + 18
        : (isMobileStatsExpanded ? 228 : 132);
    const mapHeight = isTidePlannerCollapsed
        ? isMobile
            ? `clamp(360px, calc(100dvh - ${mobileStickyOffset}px), 860px)`
            : "calc(100dvh - 242px)"
        : isMobile
          ? `clamp(320px, calc(100dvh - ${mobileStickyOffset + 230}px), 520px)`
          : "calc(100vh - 250px)";
    const controlFontSize = isMobile ? "0.95rem" : "0.85rem";
    const touchButtonSize = isMobile ? "38px" : "30px";
    const activeFilterCount =
        Number(typeFilter !== "all")
        + Number(statusFilter !== "all")
        + Number(!isLuneStationsVisible)
        + Number(!isRegionalFlowStationsVisible)
        + Number(!isContributorsVisible)
        + Number(!isHistoricalPoisVisible);
    const selectedItem = useMemo(
        () => (selectedItemId ? items.find((item) => item.id === selectedItemId) || null : null),
        [items, selectedItemId],
    );
    const selectedCounts = useMemo(
        () => (selectedItem ? getItemCounts(selectedItem) : null),
        [selectedItem, localCounts, dbCountFieldSupport],
    );
    const selectedGps = useMemo(
        () => (selectedItem ? getItemGps(selectedItem) : null),
        [selectedItem, localGps, dbGpsFieldSupport],
    );
    const selectedMapsUrl = useMemo(
        () => (selectedGps ? createMapsUrl(selectedGps.latitude, selectedGps.longitude) : null),
        [selectedGps],
    );
    const selectedGeoLookupKey = useMemo(
        () =>
            selectedGps
                ? buildGpsLookupKey(selectedGps.latitude, selectedGps.longitude)
                : "",
        [selectedGps],
    );
    const selectedGeoLookup = useMemo(
        () => (selectedItem && selectedGps ? getItemGeoLookup(selectedItem, selectedGps) : null),
        [selectedItem, selectedGps, localGeoLookup, dbGeoFieldSupport],
    );
    const selectedWeight = useMemo(
        () => (selectedItem ? getItemEstimatedWeight(selectedItem) : null),
        [selectedItem, localWeights, dbWeightFieldSupport],
    );
    const selectedStory = useMemo(
        () => (selectedItem ? getItemStory(selectedItem) : null),
        [selectedItem, localItemStory, dbStoryFieldSupport],
    );
    const selectedContributor = useMemo(
        () =>
            selectedContributorId === null
                ? null
                : contributors.find(
                    (contributor) => String(contributor?.id) === String(selectedContributorId),
                ) || null,
        [contributors, selectedContributorId],
    );
    const selectedContributorMapsUrl = useMemo(
        () => (selectedContributor ? resolveContributorMapsUrl(selectedContributor) : ""),
        [selectedContributor],
    );
    const selectedHistoricalPoi = useMemo(
        () =>
            selectedHistoricalPoiId === null
                ? null
                : historicalPois.find(
                    (poi) => String(poi?.id) === String(selectedHistoricalPoiId),
                ) || null,
        [historicalPois, selectedHistoricalPoiId],
    );
    const selectedHistoricalPoiPublicUrl = useMemo(() => {
        if (!selectedHistoricalPoi) return "";
        if (selectedHistoricalPoi.status !== HISTORICAL_POI_STATUS_PUBLISHED) return "";
        if (!selectedHistoricalPoi.is_public) return "";

        const slug = String(selectedHistoricalPoi.slug || "").trim();
        if (!slug) return "";
        if (typeof window === "undefined") return "";

        return `${window.location.origin}${import.meta.env.BASE_URL}poi/${encodeURIComponent(slug)}/`;
    }, [selectedHistoricalPoi]);
    const editingHistoricalPoi = useMemo(
        () =>
            editingHistoricalPoiId === null
                ? null
                : historicalPois.find(
                    (poi) => String(poi?.id) === String(editingHistoricalPoiId),
                ) || null,
        [historicalPois, editingHistoricalPoiId],
    );

    const closeNonRelevantOverlayUi = () => {
        setSelectedItemId(null);
        setEditingItemId(null);
        setSelectedContributorId(null);
        setIsContributorPanelOpen(false);
        setReportLocation(null);
        setPendingReportLocation(null);
        setIsReportConsentOpen(false);
        setReportNote("");
        setReportStatus("");
        setIsFilterSheetOpen(false);
        setIsMapToolsOpen(false);
    };

    const openPoiCreatePanel = () => {
        closeNonRelevantOverlayUi();
        setEditingHistoricalPoiId(null);
        setSelectedHistoricalPoiId(null);
        setIsPoiPanelOpen(true);
    };

    const openPoiEditPanel = (poiId) => {
        if (!poiId) return;
        closeNonRelevantOverlayUi();
        setEditingHistoricalPoiId(poiId);
        setSelectedHistoricalPoiId(null);
        setIsPoiPanelOpen(true);
    };

    const closePoiPanel = () => {
        setIsPoiPanelOpen(false);
        setEditingHistoricalPoiId(null);
    };
    const readyCustomHistoricOverlayLayers = useMemo(
        () => historicOverlayDrafts
            .map((draft) => {
                const normalizedCorners = normalizeHistoricOverlayCorners(draft.corners, draft.bounds);
                const normalizedBounds = deriveHistoricBoundsFromCorners(normalizedCorners)
                    || normalizeHistoricOverlayBounds(draft.bounds);
                if (
                    draft.status !== HISTORIC_OVERLAY_STATUS_READY
                    || !draft.isPublic
                    || !draft.imageUrl
                    || !normalizedCorners
                    || !normalizedBounds
                ) {
                    return null;
                }

                return {
                    ...draft,
                    corners: normalizedCorners,
                    bounds: normalizedBounds,
                    attribution: draft.attribution || "Historic map overlay (custom calibration)",
                };
            })
            .filter(Boolean),
        [historicOverlayDrafts],
    );
    const historicOverlayLayers = useMemo(
        () => [
            ...(HAS_MAPTILER_KEY ? PROVIDER_HISTORIC_OVERLAY_LAYERS : []),
            ...readyCustomHistoricOverlayLayers,
        ].sort(compareHistoricOverlayLayers),
        [readyCustomHistoricOverlayLayers],
    );
    const hasHistoricOverlayAccess = historicOverlayLayers.length > 0;
    const selectedHistoricOverlay = useMemo(
        () => historicOverlayLayers.find((layer) => layer.id === selectedHistoricOverlayId)
            || historicOverlayLayers[0]
            || null,
        [historicOverlayLayers, selectedHistoricOverlayId],
    );
    const historicOverlayTileUrl = useMemo(
        () => selectedHistoricOverlay?.type === "tile"
            ? buildHistoricOverlayTileUrl(selectedHistoricOverlay?.tileId)
            : "",
        [selectedHistoricOverlay],
    );
    const selectedHistoricOverlayDraft = useMemo(
        () => historicOverlayDrafts.find((draft) => draft.id === selectedHistoricOverlayDraftId)
            || historicOverlayDrafts[0]
            || null,
        [historicOverlayDrafts, selectedHistoricOverlayDraftId],
    );
    const canPublishSelectedHistoricOverlayDraft = useMemo(() => {
        const normalizedCorners = normalizeHistoricOverlayCorners(
            selectedHistoricOverlayDraft?.corners,
            selectedHistoricOverlayDraft?.bounds,
        );
        const normalizedBounds = deriveHistoricBoundsFromCorners(normalizedCorners)
            || normalizeHistoricOverlayBounds(selectedHistoricOverlayDraft?.bounds);

        return Boolean(
            selectedHistoricOverlayDraft
            && selectedHistoricOverlayDraft.status === HISTORIC_OVERLAY_STATUS_READY
            && selectedHistoricOverlayDraft.imageUrl
            && normalizedCorners
            && normalizedBounds,
        );
    }, [selectedHistoricOverlayDraft]);
    const historicOverlayDraftPreview = useMemo(() => {
        if (!isHistoricOverlayEditorModeEnabled || !isHistoricOverlayDraftPreviewEnabled) {
            return null;
        }

        const normalizedCorners = normalizeHistoricOverlayCorners(
            selectedHistoricOverlayDraft?.corners,
            selectedHistoricOverlayDraft?.bounds,
        );
        const normalizedBounds = deriveHistoricBoundsFromCorners(normalizedCorners)
            || normalizeHistoricOverlayBounds(selectedHistoricOverlayDraft?.bounds);
        if (!selectedHistoricOverlayDraft?.imageUrl || !normalizedCorners || !normalizedBounds) {
            return null;
        }

        return {
            ...selectedHistoricOverlayDraft,
            corners: normalizedCorners,
            bounds: normalizedBounds,
            editorOpacity: Number.isFinite(Number(selectedHistoricOverlayDraft?.editorOpacity))
                ? Number(selectedHistoricOverlayDraft.editorOpacity)
                : DEFAULT_HISTORIC_DRAFT_EDITOR_OPACITY,
        };
    }, [
        isHistoricOverlayDraftPreviewEnabled,
        isHistoricOverlayEditorModeEnabled,
        selectedHistoricOverlayDraft,
    ]);
    const shouldRenderHistoricOverlayDraftPreview = Boolean(
        historicOverlayDraftPreview
            && (
                historicOverlayDraftPreview.status !== "ready"
                || !isHistoricOverlayEnabled
                || selectedHistoricOverlayId !== historicOverlayDraftPreview.id
            ),
    );
    const historicOverlayOpacityPercent = useMemo(
        () => Math.round(historicOverlayOpacity * 100),
        [historicOverlayOpacity],
    );
    const groupedWaybackReleases = useMemo(
        () => buildWaybackReleaseGroups(waybackReleases),
        [waybackReleases],
    );
    const weatherOverlayUpdatedLabel = useMemo(() => {
        if (!weatherOverlayUpdatedAt) return "";

        const parsed = new Date(weatherOverlayUpdatedAt);
        if (Number.isNaN(parsed.getTime())) return "";

        return parsed.toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
        });
    }, [weatherOverlayUpdatedAt]);

    useEffect(() => {
        void fetchCleanupForecast();

        const intervalId = window.setInterval(() => {
            void fetchCleanupForecast();
        }, CLEANUP_FORECAST_REFRESH_MS);

        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    useEffect(() => {
        if (hasHistoricOverlayAccess) return;
        setIsHistoricOverlayEnabled(false);
        setHistoricOverlayError("");
    }, [hasHistoricOverlayAccess]);

    useEffect(() => {
        if (!historicOverlayLayers.length) return;

        const selectedLayerExists = historicOverlayLayers.some(
            (layer) => layer.id === selectedHistoricOverlayId,
        );
        if (selectedLayerExists) return;

        setSelectedHistoricOverlayId(
            historicOverlayLayers.find((layer) => layer.isDefault)?.id || historicOverlayLayers[0].id,
        );
    }, [historicOverlayLayers, selectedHistoricOverlayId]);

    useEffect(() => {
        if (!historicOverlayDrafts.length) return;

        const selectedDraftExists = historicOverlayDrafts.some(
            (draft) => draft.id === selectedHistoricOverlayDraftId,
        );
        if (selectedDraftExists) return;

        setSelectedHistoricOverlayDraftId(historicOverlayDrafts[0].id);
    }, [historicOverlayDrafts, selectedHistoricOverlayDraftId]);

    useEffect(() => {
        setHistoricOverlayError("");
    }, [selectedHistoricOverlayId]);

    useEffect(() => {
        if (!selectedGps || !selectedGeoLookupKey) {
            setIsResolvingGeoLookup(false);
            return;
        }

        const needsLookup = shouldResolveGeoLookup(selectedGeoLookup);
        if (!needsLookup) {
            setIsResolvingGeoLookup(false);
            return;
        }

        const attemptKey = `${selectedItem?.id || "unknown"}:${selectedGeoLookupKey}`;
        if (geocodeAttemptedKeysRef.current.has(attemptKey)) {
            setIsResolvingGeoLookup(false);
            return;
        }

        geocodeAttemptedKeysRef.current.add(attemptKey);

        let isCancelled = false;
        setIsResolvingGeoLookup(true);

        fetchReverseGeocodeForGps(selectedGps.latitude, selectedGps.longitude)
            .then((geoResult) => {
                if (isCancelled) return;

                setLocalGeoLookup((prev) => ({
                    ...prev,
                    [selectedGeoLookupKey]: geoResult,
                }));

                if (selectedItem?.id) {
                    void saveGeoLookupForItem(selectedItem.id, geoResult);
                }
            })
            .catch(() => {
                if (isCancelled) return;

                const fallbackGeoResult = buildFallbackGeoLookup();

                setLocalGeoLookup((prev) => ({
                    ...prev,
                    [selectedGeoLookupKey]: fallbackGeoResult,
                }));

                if (selectedItem?.id) {
                    void saveGeoLookupForItem(selectedItem.id, fallbackGeoResult);
                }
            })
            .finally(() => {
                if (!isCancelled) {
                    setIsResolvingGeoLookup(false);
                }
            });

        return () => {
            isCancelled = true;
        };
    }, [selectedGps, selectedGeoLookupKey, selectedGeoLookup, selectedItem?.id]);

    useEffect(() => {
        if (isMobile) return;
        setSelectedContributorId(null);
    }, [isMobile]);

    useEffect(() => {
        if (isContributorsVisible) return;
        setSelectedContributorId(null);
    }, [isContributorsVisible]);

    useEffect(() => {
        if (isHistoricalPoisVisible) return;
        setSelectedHistoricalPoiId(null);
    }, [isHistoricalPoisVisible]);

    useEffect(() => {
        if (selectedItemId === null) return;

        setEditingHistoricalPoiId(null);
        setSelectedHistoricalPoiId(null);
        setSelectedContributorId(null);
        setIsPoiPanelOpen(false);
        setIsContributorPanelOpen(false);
        setPendingLocation(null);
        setPendingItemType(null);
        setReportLocation(null);
        setPendingReportLocation(null);
        setIsReportConsentOpen(false);
        setReportNote("");
        setReportStatus("");
        setIsFilterSheetOpen(false);
        setIsMapToolsOpen(false);
    }, [selectedItemId]);

    useEffect(() => {
        if (selectedHistoricalPoiId === null) return;

        setEditingHistoricalPoiId(null);
        setSelectedItemId(null);
        setEditingItemId(null);
        setSelectedContributorId(null);
        setIsPoiPanelOpen(false);
        setIsContributorPanelOpen(false);
        setPendingLocation(null);
        setPendingItemType(null);
        setReportLocation(null);
        setPendingReportLocation(null);
        setIsReportConsentOpen(false);
        setReportNote("");
        setReportStatus("");
        setIsFilterSheetOpen(false);
        setIsMapToolsOpen(false);
    }, [selectedHistoricalPoiId]);

    useEffect(() => {
        if (selectedContributorId === null) return;

        const contributorStillExists = contributors.some(
            (contributor) => String(contributor?.id) === String(selectedContributorId),
        );
        if (!contributorStillExists) {
            setSelectedContributorId(null);
        }
    }, [contributors, selectedContributorId]);

    useEffect(() => {
        if (!isWeatherOverlayEnabled) {
            setWeatherOverlayError("");
            return undefined;
        }

        let isCancelled = false;

        const refreshRainRadar = async () => {
            try {
                const response = await fetch(RAINVIEWER_MAPS_URL, { cache: "no-store" });
                if (!response.ok) {
                    throw new Error("Weather overlay fetch failed");
                }

                const payload = await response.json();
                const host = typeof payload?.host === "string" && payload.host
                    ? payload.host
                    : "https://tilecache.rainviewer.com";
                const pastFrames = Array.isArray(payload?.radar?.past) ? payload.radar.past : [];
                const nowcastFrames = Array.isArray(payload?.radar?.nowcast) ? payload.radar.nowcast : [];
                const frameCandidates = [...pastFrames, ...nowcastFrames].filter(
                    (frame) => typeof frame?.path === "string" && frame.path,
                );
                const latestFrame = frameCandidates.length
                    ? frameCandidates[frameCandidates.length - 1]
                    : null;

                if (!latestFrame?.path) {
                    throw new Error("Weather overlay frame missing");
                }

                const nextTileUrl = `${host}${latestFrame.path}/256/{z}/{x}/{y}/2/1_1.png`;
                if (isCancelled) return;

                setWeatherOverlayTileUrl(nextTileUrl);
                setWeatherOverlayUpdatedAt(new Date().toISOString());
                setWeatherOverlayError("");
            } catch {
                if (isCancelled) return;

                setWeatherOverlayTileUrl("");
                setWeatherOverlayError("Weather radar is temporarily unavailable.");
            }
        };

        void refreshRainRadar();
        const intervalId = window.setInterval(refreshRainRadar, RAINVIEWER_REFRESH_MS);

        return () => {
            isCancelled = true;
            window.clearInterval(intervalId);
        };
    }, [isWeatherOverlayEnabled]);

    return (
        <div
            style={{
                padding: isMobile
                    ? "calc(env(safe-area-inset-top, 0px) + 10px) 8px 0"
                    : "18px 16px 20px",
                fontFamily:
                    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", sans-serif',
                maxWidth: "1200px",
                margin: "0 auto",
                borderRadius: isMobile ? UI_TOKENS.radius.lg : "24px",
                border: "1px solid rgba(148,163,184,0.35)",
                background:
                    "linear-gradient(180deg, rgba(255,255,255,0.88) 0%, rgba(248,250,252,0.9) 100%)",
                boxShadow: isMobile
                    ? "0 12px 30px rgba(15,23,42,0.14)"
                    : "0 20px 50px rgba(15,23,42,0.14)",
                backdropFilter: "blur(14px)",
                WebkitTapHighlightColor: "transparent",
                boxSizing: "border-box",
                minHeight: "100dvh",
                display: "flex",
                flexDirection: "column",
            }}
        >
            <div
                ref={stickyTopStackRef}
                style={{
                    position: isMobile ? "sticky" : "relative",
                    top: isMobile ? "calc(env(safe-area-inset-top, 0px) + 6px)" : undefined,
                    zIndex: isMobile ? 1050 : "auto",
                    display: "grid",
                    gap: isMobile ? "8px" : "10px",
                    marginBottom: isMobile ? "10px" : UI_TOKENS.spacing.sm,
                }}
            >
                <AppTopBar
                    isMobile={isMobile}
                    isSticky={!isMobile}
                    authReady={authReady}
                    currentUser={currentUser}
                    canManageItems={canManageItems}
                    isAuthActionLoading={isAuthActionLoading}
                    onSignIn={signInWithGitHub}
                    onSignOut={signOut}
                    isLoadingItems={isLoadingItems}
                    onOpenContributorPanel={() => setIsContributorPanelOpen(true)}
                    onOpenPoiPanel={openPoiCreatePanel}
                    isStatsExpanded={isMobileStatsExpanded}
                    onToggleStats={isMobile ? () => setIsMobileStatsExpanded((prev) => !prev) : undefined}
                    mobileStatsSummary={mobileStatsSummary}
                >
                    <SummaryStats
                        totals={totals}
                        locationCount={filteredItems.length}
                        controlFontSize={controlFontSize}
                        isMobile={isMobile}
                        impactStats={impactStats}
                    />
                </AppTopBar>

                {isMobile && authError ? (
                    <div
                        style={{
                            color: "#b91c1c",
                            fontSize: "0.82rem",
                            background: "rgba(254,242,242,0.92)",
                            border: "1px solid #fecaca",
                            borderRadius: UI_TOKENS.radius.sm,
                            padding: "8px 10px",
                        }}
                    >
                        {authError}
                    </div>
                ) : null}
            </div>

            <div
                style={{
                    marginBottom: isMobile ? "10px" : UI_TOKENS.spacing.sm,
                }}
            >
                <ControlToggles
                    isMobile={isMobile}
                    isTidePlannerCollapsed={isTidePlannerCollapsed}
                    hasHistoricOverlayAccess={hasHistoricOverlayAccess}
                    isHistoricOverlayEnabled={isHistoricOverlayEnabled}
                    isWeatherOverlayEnabled={isWeatherOverlayEnabled}
                    isContributorsVisible={isContributorsVisible}
                    isHistoricalPoisVisible={isHistoricalPoisVisible}
                    historicOverlayLayers={historicOverlayLayers}
                    selectedHistoricOverlayId={selectedHistoricOverlayId}
                    historicOverlayOpacityPercent={historicOverlayOpacityPercent}
                    weatherOverlayUpdatedLabel={weatherOverlayUpdatedLabel}
                    onToggleTidePlanner={() =>
                        setIsTidePlannerCollapsed((prev) => !prev)
                    }
                    onToggleHistoricOverlay={() => {
                        if (!hasHistoricOverlayAccess) return;
                        setHistoricOverlayError("");
                        setIsHistoricOverlayEnabled((prev) => !prev);
                    }}
                    onHistoricOverlaySelect={(nextLayerId) => {
                        setHistoricOverlayError("");
                        setSelectedHistoricOverlayId(nextLayerId);
                    }}
                    onHistoricOverlayOpacityChange={(nextValue) => {
                        const parsed = Number.parseInt(nextValue, 10);
                        if (!Number.isFinite(parsed)) return;
                        const clamped = Math.min(Math.max(parsed, 20), 100);
                        setHistoricOverlayOpacity(clamped / 100);
                    }}
                    onToggleWeatherOverlay={() =>
                        setIsWeatherOverlayEnabled((prev) => !prev)
                    }
                    onToggleContributors={() =>
                        setIsContributorsVisible((prev) => !prev)
                    }
                    onToggleHistoricalPois={() =>
                        setIsHistoricalPoisVisible((prev) => !prev)
                    }
                />
            </div>

            {isHistoricOverlayEditorModeEnabled ? (
                <div
                    style={{
                        marginBottom: "10px",
                        borderRadius: "14px",
                        border: "1px solid #cbd5e1",
                        background: "linear-gradient(145deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.96) 100%)",
                        padding: isMobile ? "12px" : "14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: "12px",
                            flexWrap: "wrap",
                        }}
                    >
                        <div>
                            <div
                                style={{
                                    fontSize: "0.92rem",
                                    fontWeight: 700,
                                    color: "#1d4ed8",
                                }}
                            >
                                Historic Overlay Draft Editor
                            </div>
                            <div
                                style={{
                                    fontSize: "0.8rem",
                                    color: "#475569",
                                    marginTop: "2px",
                                }}
                            >
                                Owner-only shared draft placement. Draft changes auto-save to Supabase and Publish makes the selected overlay public immediately.
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setIsHistoricOverlayDraftPreviewEnabled((prev) => !prev)}
                            style={{
                                borderRadius: UI_TOKENS.radius.pill,
                                border: isHistoricOverlayDraftPreviewEnabled
                                    ? "1px solid #1d4ed8"
                                    : "1px solid #cbd5e1",
                                background: isHistoricOverlayDraftPreviewEnabled
                                    ? "linear-gradient(135deg, #dbeafe, #eff6ff)"
                                    : "linear-gradient(135deg, #eff6ff, #f8fafc)",
                                color: isHistoricOverlayDraftPreviewEnabled ? "#1d4ed8" : "#0f172a",
                                padding: "7px 11px",
                                fontSize: "0.79rem",
                                fontWeight: 700,
                                cursor: "pointer",
                            }}
                        >
                            {isHistoricOverlayDraftPreviewEnabled ? "Draft Preview On" : "Draft Preview Off"}
                        </button>
                    </div>

                    {historicOverlayLoadError || historicOverlaySyncStatus.message ? (
                        <div
                            style={{
                                borderRadius: "12px",
                                border: historicOverlaySyncStatus.kind === "error"
                                    ? "1px solid #fecaca"
                                    : "1px solid #bfdbfe",
                                background: historicOverlaySyncStatus.kind === "error"
                                    ? "#fef2f2"
                                    : "#eff6ff",
                                color: historicOverlaySyncStatus.kind === "error" ? "#b91c1c" : "#1d4ed8",
                                padding: "9px 11px",
                                fontSize: "0.8rem",
                                lineHeight: 1.45,
                            }}
                        >
                            {historicOverlayLoadError || historicOverlaySyncStatus.message}
                        </div>
                    ) : null}

                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1.2fr)",
                            gap: "12px",
                        }}
                    >
                        <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            <span style={{ fontSize: "0.77rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                Draft Map
                            </span>
                            <select
                                value={selectedHistoricOverlayDraftId}
                                onChange={(event) => setSelectedHistoricOverlayDraftId(event.target.value)}
                                style={{
                                    minHeight: "38px",
                                    borderRadius: "10px",
                                    border: "1px solid #cbd5e1",
                                    background: "#ffffff",
                                    color: "#0f172a",
                                    padding: "8px 10px",
                                    fontSize: "0.9rem",
                                }}
                            >
                                {historicOverlayDrafts.map((draft) => (
                                    <option key={draft.id} value={draft.id}>
                                        {draft.label}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "end" }}>
                            <button
                                type="button"
                                onClick={() => {
                                    if (!mapInstance || !selectedHistoricOverlayDraft) return;

                                    const currentBounds = mapInstance.getBounds();
                                    setHistoricOverlayDrafts((prev) => prev.map((draft) => (
                                        draft.id === selectedHistoricOverlayDraft.id
                                            ? {
                                                ...draft,
                                                corners: buildHistoricDraftCornersFromBounds([
                                                    [currentBounds.getSouth(), currentBounds.getWest()],
                                                    [currentBounds.getNorth(), currentBounds.getEast()],
                                                ]),
                                                bounds: [
                                                    [currentBounds.getSouth(), currentBounds.getWest()],
                                                    [currentBounds.getNorth(), currentBounds.getEast()],
                                                ],
                                            }
                                            : draft
                                    )));
                                }}
                                disabled={!mapInstance || !selectedHistoricOverlayDraft}
                                style={{
                                    borderRadius: UI_TOKENS.radius.pill,
                                    border: "1px solid #93c5fd",
                                    background: "#eff6ff",
                                    color: "#1d4ed8",
                                    padding: "7px 11px",
                                    fontSize: "0.79rem",
                                    fontWeight: 700,
                                    cursor: !mapInstance || !selectedHistoricOverlayDraft ? "not-allowed" : "pointer",
                                    opacity: !mapInstance || !selectedHistoricOverlayDraft ? 0.6 : 1,
                                }}
                            >
                                Use Current Map View
                            </button>

                            <button
                                type="button"
                                onClick={() => {
                                    if (!selectedHistoricOverlayDraft) return;
                                    setHistoricOverlayDrafts((prev) => prev.map((draft) => (
                                        draft.id === selectedHistoricOverlayDraft.id
                                            ? {
                                                ...draft,
                                                corners: buildHistoricDraftCornersFromBounds(draft.bounds),
                                            }
                                            : draft
                                    )));
                                }}
                                disabled={!selectedHistoricOverlayDraft?.bounds}
                                style={{
                                    borderRadius: UI_TOKENS.radius.pill,
                                    border: "1px solid #cbd5e1",
                                    background: "#ffffff",
                                    color: "#334155",
                                    padding: "7px 11px",
                                    fontSize: "0.79rem",
                                    fontWeight: 700,
                                    cursor: !selectedHistoricOverlayDraft?.bounds ? "not-allowed" : "pointer",
                                    opacity: !selectedHistoricOverlayDraft?.bounds ? 0.6 : 1,
                                }}
                            >
                                Reset To Bounds
                            </button>

                            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.8rem", color: "#334155" }}>
                                <span>Status</span>
                                <select
                                    value={selectedHistoricOverlayDraft?.status || "draft"}
                                    onChange={(event) => {
                                        const nextStatus = event.target.value === HISTORIC_OVERLAY_STATUS_READY
                                            ? HISTORIC_OVERLAY_STATUS_READY
                                            : HISTORIC_OVERLAY_STATUS_DRAFT;
                                        setHistoricOverlayDrafts((prev) => prev.map((draft) => (
                                            draft.id === selectedHistoricOverlayDraftId
                                                ? {
                                                    ...draft,
                                                    status: nextStatus,
                                                    isPublic: nextStatus === HISTORIC_OVERLAY_STATUS_READY
                                                        ? draft.isPublic
                                                        : false,
                                                    publishedAt: nextStatus === HISTORIC_OVERLAY_STATUS_READY
                                                        ? draft.publishedAt
                                                        : "",
                                                }
                                                : draft
                                        )));
                                    }}
                                    style={{
                                        minHeight: "34px",
                                        borderRadius: "10px",
                                        border: "1px solid #cbd5e1",
                                        background: "#ffffff",
                                        color: "#0f172a",
                                        padding: "6px 8px",
                                        fontSize: "0.84rem",
                                    }}
                                >
                                    <option value="draft">Draft only</option>
                                    <option value="ready">Ready for public selector</option>
                                </select>
                            </label>

                            <button
                                type="button"
                                onClick={() => {
                                    void publishHistoricOverlay(selectedHistoricOverlayDraftId);
                                }}
                                disabled={!canPublishSelectedHistoricOverlayDraft || publishingHistoricOverlayId === selectedHistoricOverlayDraftId}
                                style={{
                                    borderRadius: UI_TOKENS.radius.pill,
                                    border: "1px solid #1d4ed8",
                                    background: "linear-gradient(135deg, #1d4ed8, #2563eb)",
                                    color: "#ffffff",
                                    padding: "7px 12px",
                                    fontSize: "0.79rem",
                                    fontWeight: 700,
                                    cursor: !canPublishSelectedHistoricOverlayDraft || publishingHistoricOverlayId === selectedHistoricOverlayDraftId
                                        ? "not-allowed"
                                        : "pointer",
                                    opacity: !canPublishSelectedHistoricOverlayDraft || publishingHistoricOverlayId === selectedHistoricOverlayDraftId
                                        ? 0.6
                                        : 1,
                                }}
                            >
                                {publishingHistoricOverlayId === selectedHistoricOverlayDraftId
                                    ? "Publishing..."
                                    : (selectedHistoricOverlayDraft?.isPublic ? "Republish Public Overlay" : "Publish Public Overlay")}
                            </button>

                            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.8rem", color: "#334155", minWidth: isMobile ? "100%" : "220px" }}>
                                <span>Editor Opacity</span>
                                <input
                                    type="range"
                                    min="10"
                                    max="100"
                                    step="1"
                                    value={Math.round((selectedHistoricOverlayDraft?.editorOpacity || DEFAULT_HISTORIC_DRAFT_EDITOR_OPACITY) * 100)}
                                    onChange={(event) => {
                                        const parsed = Number.parseInt(event.target.value, 10);
                                        if (!Number.isFinite(parsed)) return;
                                        const nextOpacity = Math.min(Math.max(parsed, 10), 100) / 100;
                                        setHistoricOverlayDrafts((prev) => prev.map((draft) => (
                                            draft.id === selectedHistoricOverlayDraftId
                                                ? { ...draft, editorOpacity: nextOpacity }
                                                : draft
                                        )));
                                    }}
                                    style={{ width: "100%", accentColor: "#2563eb" }}
                                />
                            </label>
                        </div>
                    </div>

                    {selectedHistoricOverlayDraft ? (
                        <>
                            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                <span style={{ fontSize: "0.77rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                    Image URL
                                </span>
                                <input
                                    type="url"
                                    value={selectedHistoricOverlayDraft.imageUrl}
                                    readOnly
                                    placeholder="https://... or /historic/mackreth-1778.jpg"
                                    style={{ minHeight: "38px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#f8fafc", color: "#0f172a", padding: "8px 10px", fontSize: "0.9rem" }}
                                />
                            </label>

                            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    <span style={{ fontSize: "0.77rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                        Source URL
                                    </span>
                                    <input
                                        type="url"
                                        value={selectedHistoricOverlayDraft.sourceUrl}
                                        onChange={(event) => {
                                            const nextValue = event.target.value;
                                            setHistoricOverlayDrafts((prev) => prev.map((draft) => (
                                                draft.id === selectedHistoricOverlayDraftId
                                                    ? { ...draft, sourceUrl: nextValue }
                                                    : draft
                                            )));
                                        }}
                                        placeholder="Archive page or source record"
                                        style={{ minHeight: "38px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a", padding: "8px 10px", fontSize: "0.9rem" }}
                                    />
                                </label>

                                <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                    <span style={{ fontSize: "0.77rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                        Attribution
                                    </span>
                                    <input
                                        type="text"
                                        value={selectedHistoricOverlayDraft.attribution}
                                        onChange={(event) => {
                                            const nextValue = event.target.value;
                                            setHistoricOverlayDrafts((prev) => prev.map((draft) => (
                                                draft.id === selectedHistoricOverlayDraftId
                                                    ? { ...draft, attribution: nextValue }
                                                    : draft
                                            )));
                                        }}
                                        placeholder="Archive / library credit"
                                        style={{ minHeight: "38px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a", padding: "8px 10px", fontSize: "0.9rem" }}
                                    />
                                </label>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
                                {[
                                    { key: "nw", label: "North West" },
                                    { key: "ne", label: "North East" },
                                    { key: "se", label: "South East" },
                                    { key: "sw", label: "South West" },
                                ].map((cornerField) => {
                                    const currentCorner = selectedHistoricOverlayDraft.corners?.[cornerField.key] || ["", ""];

                                    return (
                                        <div key={cornerField.key} style={{ border: "1px solid #dbeafe", borderRadius: "12px", background: "#f8fbff", padding: "10px", display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                                            <div style={{ gridColumn: "1 / -1", fontSize: "0.77rem", fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                                {cornerField.label}
                                            </div>
                                            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                                    Lat
                                                </span>
                                                <input
                                                    type="number"
                                                    step="0.000001"
                                                    value={Number.isFinite(Number(currentCorner[0])) ? Number(currentCorner[0]) : ""}
                                                    onChange={(event) => {
                                                        const nextValue = Number.parseFloat(event.target.value);
                                                        setHistoricOverlayDrafts((prev) => prev.map((draft) => {
                                                            if (draft.id !== selectedHistoricOverlayDraftId) return draft;
                                                            const nextCorners = {
                                                                ...(draft.corners || buildHistoricDraftCornersFromBounds(draft.bounds) || {}),
                                                                [cornerField.key]: [
                                                                    Number.isFinite(nextValue) ? nextValue : null,
                                                                    draft.corners?.[cornerField.key]?.[1] ?? null,
                                                                ],
                                                            };
                                                            return {
                                                                ...draft,
                                                                corners: nextCorners,
                                                                bounds: deriveHistoricBoundsFromCorners(nextCorners) || draft.bounds,
                                                            };
                                                        }));
                                                    }}
                                                    style={{ minHeight: "38px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a", padding: "8px 10px", fontSize: "0.9rem" }}
                                                />
                                            </label>
                                            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                                                <span style={{ fontSize: "0.72rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                                    Lng
                                                </span>
                                                <input
                                                    type="number"
                                                    step="0.000001"
                                                    value={Number.isFinite(Number(currentCorner[1])) ? Number(currentCorner[1]) : ""}
                                                    onChange={(event) => {
                                                        const nextValue = Number.parseFloat(event.target.value);
                                                        setHistoricOverlayDrafts((prev) => prev.map((draft) => {
                                                            if (draft.id !== selectedHistoricOverlayDraftId) return draft;
                                                            const nextCorners = {
                                                                ...(draft.corners || buildHistoricDraftCornersFromBounds(draft.bounds) || {}),
                                                                [cornerField.key]: [
                                                                    draft.corners?.[cornerField.key]?.[0] ?? null,
                                                                    Number.isFinite(nextValue) ? nextValue : null,
                                                                ],
                                                            };
                                                            return {
                                                                ...draft,
                                                                corners: nextCorners,
                                                                bounds: deriveHistoricBoundsFromCorners(nextCorners) || draft.bounds,
                                                            };
                                                        }));
                                                    }}
                                                    style={{ minHeight: "38px", borderRadius: "10px", border: "1px solid #cbd5e1", background: "#ffffff", color: "#0f172a", padding: "8px 10px", fontSize: "0.9rem" }}
                                                />
                                            </label>
                                        </div>
                                    );
                                })}
                            </div>

                            <div
                                style={{
                                    borderRadius: "12px",
                                    border: "1px solid #dbeafe",
                                    background: "#eff6ff",
                                    padding: "10px 12px",
                                    color: "#1e3a8a",
                                    fontSize: "0.8rem",
                                    lineHeight: 1.5,
                                }}
                            >
                                Drag the blue corner handles on the map to rotate or reshape the draft, or use the numeric corner fields here for precise placement. The green center handle moves the full draft without changing its shape.
                                {selectedHistoricOverlayDraft?.isPublic
                                    ? " This overlay is currently public; further edits will auto-save and change the live version."
                                    : " Mark the draft ready, then Publish when you want it to appear for everyone."}
                            </div>
                        </>
                    ) : null}
                </div>
            ) : null}

            {isDeferredUiReady ? (
                <Suspense fallback={null}>
                    <LazyTidePlanner
                        isTidePlannerCollapsed={isTidePlannerCollapsed}
                        isMobile={isMobile}
                        isLoadingLancasterTides={isLoadingLancasterTides}
                        fetchLancasterTides={fetchLancasterTides}
                        lancasterTideUpdatedAt={lancasterTideUpdatedAt}
                        lancasterTideError={lancasterTideError}
                        tideChartData={tideChartData}
                        tideChartUrl={LANCASTER_TIDE_CHART_URL}
                        buildCurrentTideMarker={buildCurrentTideMarker}
                        formatTideTime={formatTideTime}
                        formatTideClockTime={formatTideClockTime}
                        formatTideDay={formatTideDay}
                        cleanupPlannerSensors={cleanupPlannerSensors}
                        cleanupForecast={cleanupForecast}
                        cleanupForecastError={cleanupForecastError}
                        cleanupForecastUpdatedLabel={cleanupForecastUpdatedLabel}
                        isLoadingCleanupForecast={isLoadingCleanupForecast}
                    />
                </Suspense>
            ) : null}

            <MapStatusBanner
                isLoadingItems={isLoadingItems}
                totalItemCount={items.length}
                filteredItemCount={filteredItems.length}
                isMobile={isMobile}
            />

            {isWeatherOverlayEnabled && weatherOverlayError ? (
                <div
                    style={{
                        marginBottom: "8px",
                        padding: isMobile ? "9px 10px" : "8px 10px",
                        borderRadius: "10px",
                        border: "1px solid #fcd34d",
                        background: "#fffbeb",
                        color: "#92400e",
                        fontSize: "0.82rem",
                        lineHeight: 1.4,
                    }}
                >
                    {weatherOverlayError}
                </div>
            ) : null}

            {isHistoricOverlayEnabled && historicOverlayError ? (
                <div
                    style={{
                        marginBottom: "8px",
                        padding: isMobile ? "9px 10px" : "8px 10px",
                        borderRadius: "10px",
                        border: "1px solid #bef264",
                        background: "#f7fee7",
                        color: "#3f6212",
                        fontSize: "0.82rem",
                        lineHeight: 1.4,
                    }}
                >
                    {historicOverlayError}
                </div>
            ) : null}

            <div
                ref={mapOverlayRootRef}
                style={{
                    position: "relative",
                    marginTop: isTidePlannerCollapsed ? "2px" : "0",
                    flex: isTidePlannerCollapsed ? "1 1 auto" : "0 0 auto",
                    minHeight: 0,
                }}
            >
                <MapContainer
                    center={RIVER_LUNE_CENTER}
                    zoom={RIVER_LUNE_ZOOM}
                    tap={true}
                    touchZoom={true}
                    style={{
                        height: mapHeight,
                        minHeight: isMobile ? "360px" : "400px",
                        width: "100%",
                        border: "2px solid #333",
                        borderRadius: "12px",
                        zIndex: 0,
                    }}
                >
                    {selectedWaybackId ? (
                        <TileLayer
                            key={`wayback-${selectedWaybackId}`}
                            url={`https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/${selectedWaybackId}/{z}/{y}/{x}`}
                            attribution='&copy; <a href="https://www.arcgis.com/">Esri</a> Wayback Imagery'
                            maxZoom={21}
                        />
                    ) : HAS_MAPBOX_TOKEN ? (
                        <TileLayer
                            key="mapbox-live"
                            url={`https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=${MAPBOX_TOKEN}`}
                            attribution='&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                            tileSize={512}
                            zoomOffset={-1}
                            maxZoom={22}
                        />
                    ) : (
                        <TileLayer
                            key="osm-fallback"
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                            maxZoom={19}
                        />
                    )}
                    {isWeatherOverlayEnabled && weatherOverlayTileUrl ? (
                        <TileLayer
                            key={`rainviewer-${weatherOverlayUpdatedAt || "live"}`}
                            url={weatherOverlayTileUrl}
                            attribution='Weather radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a>'
                            opacity={0.58}
                            maxZoom={19}
                            maxNativeZoom={RAINVIEWER_MAX_SUPPORTED_ZOOM}
                        />
                    ) : null}
                    {shouldRenderHistoricOverlayDraftPreview ? (
                        <TransformedHistoricImageOverlay
                            key={`historic-draft-preview-${historicOverlayDraftPreview.id}`}
                            imageUrl={historicOverlayDraftPreview.imageUrl}
                            corners={historicOverlayDraftPreview.corners}
                            attribution={historicOverlayDraftPreview.attribution || "Historic draft preview"}
                            opacity={historicOverlayDraftPreview.editorOpacity}
                            onLoad={() => {
                                setHistoricOverlayError("");
                            }}
                            onError={() => {
                                setHistoricOverlayError(
                                    `Historic draft \"${historicOverlayDraftPreview.label}\" could not be loaded right now.`,
                                );
                            }}
                        />
                    ) : null}
                    {isHistoricOverlayEditorModeEnabled && historicOverlayDraftPreview?.corners ? (
                        <HistoricOverlayCornerHandles
                            corners={historicOverlayDraftPreview.corners}
                            onCornerChange={(cornerKey, nextCorner) => {
                                setHistoricOverlayDrafts((prev) => prev.map((draft) => {
                                    if (draft.id !== historicOverlayDraftPreview.id) return draft;
                                    const nextCorners = {
                                        ...(draft.corners || buildHistoricDraftCornersFromBounds(draft.bounds) || {}),
                                        [cornerKey]: nextCorner,
                                    };
                                    return {
                                        ...draft,
                                        corners: nextCorners,
                                        bounds: deriveHistoricBoundsFromCorners(nextCorners) || draft.bounds,
                                    };
                                }));
                            }}
                            onMoveOverlay={(latitudeDelta, longitudeDelta) => {
                                setHistoricOverlayDrafts((prev) => prev.map((draft) => {
                                    if (draft.id !== historicOverlayDraftPreview.id) return draft;
                                    const nextCorners = offsetHistoricOverlayCorners(
                                        draft.corners || buildHistoricDraftCornersFromBounds(draft.bounds),
                                        latitudeDelta,
                                        longitudeDelta,
                                    );
                                    return {
                                        ...draft,
                                        corners: nextCorners,
                                        bounds: deriveHistoricBoundsFromCorners(nextCorners) || draft.bounds,
                                    };
                                }));
                            }}
                        />
                    ) : null}
                    {isHistoricOverlayEnabled && selectedHistoricOverlay ? (
                        selectedHistoricOverlay.type === "tile" ? (
                            <TileLayer
                                key={`historic-overlay-${selectedHistoricOverlay.id}`}
                                url={historicOverlayTileUrl}
                                attribution={selectedHistoricOverlay.attribution || HISTORIC_OVERLAY_ATTRIBUTION}
                                opacity={historicOverlayOpacity}
                                maxZoom={19}
                                eventHandlers={{
                                    load: () => {
                                        setHistoricOverlayError("");
                                    },
                                    tileerror: () => {
                                        setHistoricOverlayError(
                                            `Historic layer \"${selectedHistoricOverlay.label}\" could not be loaded right now.`,
                                        );
                                    },
                                }}
                            />
                        ) : (
                            <TransformedHistoricImageOverlay
                                key={`historic-overlay-${selectedHistoricOverlay.id}`}
                                imageUrl={selectedHistoricOverlay.imageUrl}
                                corners={selectedHistoricOverlay.corners}
                                attribution={selectedHistoricOverlay.attribution || "Historic map overlay (custom calibration)"}
                                opacity={historicOverlayOpacity}
                                onLoad={() => {
                                    setHistoricOverlayError("");
                                }}
                                onError={() => {
                                    setHistoricOverlayError(
                                        `Historic layer \"${selectedHistoricOverlay.label}\" could not be loaded right now.`,
                                    );
                                }}
                            />
                        )
                    ) : null}
                    <WeatherOverlayZoomGuard
                        isWeatherOverlayEnabled={isWeatherOverlayEnabled}
                    />
                    <MapInstanceBinder onMapReady={setMapInstance} />
                    <LiveLocationPane onReady={setIsLiveLocationPaneReady} />
                    <MapEvents />
                    <LiveLocationAutoCenter />

                    {pendingLocation && (
                        <Marker
                            position={[pendingLocation.y, pendingLocation.x]}
                            icon={pendingPlacementIcon}
                            interactive={false}
                        />
                    )}

                    {reportLocation && (
                        <Marker
                            position={[reportLocation.y, reportLocation.x]}
                            icon={pendingPlacementIcon}
                            interactive={false}
                        />
                    )}

                    <PendingPlacementOverlay
                        pendingLocation={pendingLocation}
                        pendingItemType={pendingItemType}
                        pendingCount={pendingCount}
                        pendingEstimatedWeight={pendingEstimatedWeight}
                        isSavingItem={isSavingItem}
                        isPickingImage={isPickingImage}
                        uploadProgressText={uploadProgressText}
                        isMobile={isMobile}
                        controlFontSize={controlFontSize}
                        touchButtonSize={touchButtonSize}
                        setPendingCount={setPendingCount}
                        setPendingEstimatedWeight={setPendingEstimatedWeight}
                        setPendingItemType={setPendingItemType}
                        setPendingLocation={setPendingLocation}
                        handleTypePick={handleTypePick}
                        markOverlayInteraction={markOverlayInteraction}
                        overlayPortalElement={mapOverlayRootRef.current}
                        w3wWords={pendingItemW3WWords}
                        w3wLoading={pendingItemW3WLoading}
                        onFetchW3W={handleFetchPendingW3W}
                    />

                    <PublicReportOverlay
                        reportLocation={
                            canUsePublicReports ? reportLocation : null
                        }
                        reportNote={reportNote}
                        reportStatus={reportStatus}
                        isMobile={isMobile}
                        onNoteChange={(nextValue) =>
                            setReportNote(preserveReportNoteInput(nextValue))
                        }
                        onOpenMessenger={handleOpenMessengerForReport}
                        onOpenEmail={handleOpenEmailForReport}
                        onCopyReportText={() => {
                            const msg = buildCurrentReportMessage();
                            copyTextToClipboard(msg).then((copied) => {
                                setReportStatusMessage(
                                    copied ? "Report text copied to clipboard." : "Could not copy automatically — please copy manually.",
                                    2600,
                                );
                            }).catch(() => {
                                setReportStatusMessage("Could not copy automatically — please copy manually.", 2600);
                            });
                        }}
                        onCancel={() => {
                            setReportLocation(null);
                            setReportNote("");
                            setReportStatus("");
                        }}
                        markOverlayInteraction={markOverlayInteraction}
                        hasMessengerTarget={hasMessengerTarget}
                        hasEmailTarget={hasCommunityEmailTarget}
                        overlayPortalElement={mapOverlayRootRef.current}
                    />

                    {filteredItems.map((item) => {
                        const gps = getItemGps(item);
                        if (!gps) return null;
                        return (
                            <Marker
                                key={item.id}
                                position={[gps.latitude, gps.longitude]}
                                icon={getIcon(
                                    item.type,
                                    getItemCounts(item).isRecovered,
                                )}
                                eventHandlers={{
                                    click: () => {
                                        setSelectedItemId(item.id);
                                        setEditingItemId(null);
                                    },
                                }}
                            />
                        );
                    })}

                    {isHistoricalPoisVisible
                        ? historicalPois.map((poi) => {
                              const latitude = Number(poi?.latitude);
                              const longitude = Number(poi?.longitude);

                              if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
                                  return null;
                              }

                              return (
                                  <Marker
                                      key={`historical-poi-${poi.id}`}
                                      position={[latitude, longitude]}
                                      icon={getPoiIcon(Boolean(poi?.is_historic), Boolean(poi?.is_museum))}
                                      eventHandlers={{
                                          click: () => {
                                              setSelectedHistoricalPoiId(poi.id);
                                          },
                                      }}
                                  />
                              );
                          })
                        : null}

                    {isContributorsVisible
                        ? contributors.map((contributor) => {
                              const lat = Number(contributor?.lat);
                              const lng = Number(contributor?.lng);
                              const contributorMapsUrl =
                                  resolveContributorMapsUrl(contributor);
                              if (
                                  !Number.isFinite(lat) ||
                                  !Number.isFinite(lng)
                              )
                                  return null;

                              return (
                                  <Marker
                                      key={`contributor-${contributor.id}`}
                                      position={[lat, lng]}
                                      icon={getContributorIcon(
                                          contributor.logo_url,
                                          contributor.name,
                                      )}
                                      eventHandlers={{
                                          click: (event) => {
                                              if (isMobile) {
                                                  setSelectedContributorId(
                                                      contributor.id,
                                                  );
                                                  return;
                                              }

                                              event.target.openPopup();
                                          },
                                      }}
                                  >
                                      {!isMobile ? (
                                          <Popup
                                              className="contributor-popup"
                                              autoPan
                                              keepInView
                                              autoPanPadding={[20, 20]}
                                              maxWidth={520}
                                              minWidth={260}
                                          >
                                              <div
                                                  className="contributor-popup-content"
                                                  style={{
                                                      display: "flex",
                                                      flexDirection: "row",
                                                      flexWrap: "wrap",
                                                      alignItems: "stretch",
                                                      gap: "8px",
                                                      minWidth: 0,
                                                      width: "min(468px, calc(100vw - 44px))",
                                                      maxWidth: "100%",
                                                      boxSizing: "border-box",
                                                  }}
                                              >
                                                  <div
                                                      className="contributor-popup-panel contributor-popup-header"
                                                      style={{
                                                          borderRadius: "12px",
                                                          border: "1px solid #dbe5f4",
                                                          background:
                                                              "linear-gradient(140deg, #f8fafc 0%, #eef4ff 100%)",
                                                          display: "grid",
                                                          justifyItems:
                                                              "center",
                                                          gap: "10px",
                                                          padding:
                                                              "12px 12px 10px",
                                                          flex: "0 1 160px",
                                                          minWidth: "136px",
                                                          overflow: "hidden",
                                                      }}
                                                  >
                                                      <div
                                                          className="contributor-popup-logo-frame"
                                                          style={{
                                                              width: "84px",
                                                              height: "84px",
                                                              borderRadius:
                                                                  "14px",
                                                              border: "1px solid #cbd5e1",
                                                              background:
                                                                  "#f8fafc",
                                                              boxShadow:
                                                                  "inset 0 1px 0 rgba(255, 255, 255, 0.7)",
                                                              display: "grid",
                                                              placeItems:
                                                                  "center",
                                                              overflow:
                                                                  "hidden",
                                                          }}
                                                      >
                                                          {contributor.logo_url ? (
                                                              <img
                                                                  src={
                                                                      contributor.logo_url
                                                                  }
                                                                  alt={`${contributor.name || "Business"} logo`}
                                                                  className="contributor-popup-logo"
                                                                  style={{
                                                                      width: "100%",
                                                                      height: "100%",
                                                                      maxWidth:
                                                                          "74px",
                                                                      maxHeight:
                                                                          "74px",
                                                                      objectFit:
                                                                          "contain",
                                                                      borderRadius:
                                                                          "8px",
                                                                      flexShrink: 0,
                                                                  }}
                                                              />
                                                          ) : (
                                                              <div
                                                                  className="contributor-popup-logo-placeholder"
                                                                  aria-hidden="true"
                                                                  style={{
                                                                      width: "100%",
                                                                      height: "100%",
                                                                      maxWidth:
                                                                          "74px",
                                                                      maxHeight:
                                                                          "74px",
                                                                      borderRadius:
                                                                          "10px",
                                                                      border: "1px dashed #94a3b8",
                                                                      background:
                                                                          "linear-gradient(140deg, #e2e8f0, #cbd5e1)",
                                                                      flexShrink: 0,
                                                                  }}
                                                              />
                                                          )}
                                                      </div>
                                                      <div
                                                          className="contributor-popup-title-row"
                                                          style={{
                                                              display: "flex",
                                                              flexDirection:
                                                                  "column",
                                                              alignItems:
                                                                  "center",
                                                              gap: "4px",
                                                              marginBottom: 0,
                                                              minWidth: 0,
                                                              width: "100%",
                                                          }}
                                                      >
                                                          <strong
                                                              style={{
                                                                  color: "#0f172a",
                                                                  fontSize:
                                                                      "0.94rem",
                                                                  fontWeight: 700,
                                                                  lineHeight: 1.2,
                                                                  overflowWrap:
                                                                      "anywhere",
                                                                  wordBreak:
                                                                      "break-word",
                                                                  textAlign:
                                                                      "center",
                                                              }}
                                                          >
                                                              {contributor.name ||
                                                                  "Contributor"}
                                                          </strong>
                                                          <span className="contributor-popup-badge">
                                                              Contributed
                                                          </span>
                                                      </div>
                                                      <div
                                                          style={{
                                                              display: "flex",
                                                              flexDirection:
                                                                  "column",
                                                              gap: "6px",
                                                              width: "100%",
                                                              minWidth: 0,
                                                          }}
                                                      >
                                                          {contributor.website_url ? (
                                                              <a
                                                                  href={
                                                                      contributor.website_url
                                                                  }
                                                                  target="_blank"
                                                                  rel="noreferrer"
                                                                  style={{
                                                                      display:
                                                                          "inline-flex",
                                                                      justifyContent:
                                                                          "center",
                                                                      alignItems:
                                                                          "center",
                                                                      width: "100%",
                                                                      minHeight:
                                                                          "30px",
                                                                      padding:
                                                                          "0 9px",
                                                                      borderRadius:
                                                                          "999px",
                                                                      border: "1px solid #93c5fd",
                                                                      background:
                                                                          "#eff6ff",
                                                                      color: "#1d4ed8",
                                                                      fontSize:
                                                                          "0.74rem",
                                                                      fontWeight: 700,
                                                                      textDecoration:
                                                                          "none",
                                                                      boxSizing:
                                                                          "border-box",
                                                                  }}
                                                              >
                                                                  Visit Website
                                                              </a>
                                                          ) : null}
                                                          {contributorMapsUrl ? (
                                                              <a
                                                                  href={
                                                                      contributorMapsUrl
                                                                  }
                                                                  target="_blank"
                                                                  rel="noreferrer"
                                                                  style={{
                                                                      display:
                                                                          "inline-flex",
                                                                      justifyContent:
                                                                          "center",
                                                                      alignItems:
                                                                          "center",
                                                                      width: "100%",
                                                                      minHeight:
                                                                          "30px",
                                                                      padding:
                                                                          "0 9px",
                                                                      borderRadius:
                                                                          "999px",
                                                                      border: "1px solid #2563eb",
                                                                      background:
                                                                          "linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%)",
                                                                      color: "#ffffff",
                                                                      fontSize:
                                                                          "0.74rem",
                                                                      fontWeight: 700,
                                                                      textDecoration:
                                                                          "none",
                                                                      boxSizing:
                                                                          "border-box",
                                                                  }}
                                                              >
                                                                  Open In Google
                                                                  Maps
                                                              </a>
                                                          ) : null}
                                                      </div>
                                                  </div>
                                                  <div
                                                      className="contributor-popup-panel contributor-popup-details"
                                                      style={{
                                                          borderRadius: "12px",
                                                          border: "1px solid #dbe5f4",
                                                          background: "#ffffff",
                                                          display: "grid",
                                                          gap: "8px",
                                                          flex: "1 1 240px",
                                                          minWidth: 0,
                                                          padding: "10px 11px",
                                                          textAlign: "left",
                                                          overflow: "hidden",
                                                      }}
                                                  >
                                                      {contributor.description ? (
                                                          <div
                                                              style={{
                                                                  borderRadius:
                                                                      "8px",
                                                                  border: "1px solid #e2e8f0",
                                                                  background:
                                                                      "#f8fafc",
                                                                  padding:
                                                                      "6px 7px",
                                                                  maxHeight:
                                                                      "108px",
                                                                  overflowX:
                                                                      "hidden",
                                                                  overflowY:
                                                                      "auto",
                                                              }}
                                                          >
                                                              <p
                                                                  style={{
                                                                      margin: 0,
                                                                      color: "#334155",
                                                                      fontSize:
                                                                          "0.8rem",
                                                                      lineHeight: 1.45,
                                                                      overflowWrap:
                                                                          "anywhere",
                                                                      wordBreak:
                                                                          "break-word",
                                                                  }}
                                                              >
                                                                  {
                                                                      contributor.description
                                                                  }
                                                              </p>
                                                          </div>
                                                      ) : null}
                                                      {contributor.contribution_note ? (
                                                          <p
                                                              className="contributor-popup-note"
                                                              style={{
                                                                  margin: 0,
                                                                  color: "#1e3a8a",
                                                                  fontSize:
                                                                      "0.8rem",
                                                                  fontWeight: 600,
                                                                  lineHeight: 1.45,
                                                                  overflowWrap:
                                                                      "anywhere",
                                                                  wordBreak:
                                                                      "break-word",
                                                              }}
                                                          >
                                                              {
                                                                  contributor.contribution_note
                                                              }
                                                          </p>
                                                      ) : null}
                                                  </div>
                                              </div>
                                          </Popup>
                                      ) : null}
                                  </Marker>
                              );
                          })
                        : null}

                    {isLuneStationsVisible
                        ? luneStations.map((station) => {
                              const lat = Number(station?.lat);
                              const lng = Number(station?.long);
                              if (
                                  !Number.isFinite(lat) ||
                                  !Number.isFinite(lng)
                              )
                                  return null;

                              const stationKey = getEaStationKey(station);
                              if (!stationKey) return null;

                              return (
                                  <Marker
                                      key={stationKey}
                                      position={[lat, lng]}
                                      icon={getStationIcon()}
                                  >
                                      <Popup>
                                          <StationPopupContent
                                              station={station}
                                              reading={
                                                  luneStationReadings[
                                                      stationKey
                                                  ]
                                              }
                                          />
                                      </Popup>
                                  </Marker>
                              );
                          })
                        : null}

                    {isRegionalFlowStationsVisible
                        ? regionalFlowStations.map((station) => {
                              const lat = Number(station?.lat);
                              const lng = Number(station?.long);
                              if (
                                  !Number.isFinite(lat) ||
                                  !Number.isFinite(lng)
                              )
                                  return null;

                              const stationKey = getEaStationKey(station);
                              if (
                                  !stationKey ||
                                  luneStationKeySet.has(stationKey)
                              )
                                  return null;

                              const reading = regionalFlowReadings[stationKey];
                              const hasValidReading = Number.isFinite(
                                  Number(reading?.value),
                              );
                              if (
                                  !reading ||
                                  reading.loading ||
                                  !hasValidReading ||
                                  reading.error
                              )
                                  return null;

                              return (
                                  <Marker
                                      key={`flow-${stationKey}`}
                                      position={[lat, lng]}
                                      icon={getFlowStationIcon()}
                                  >
                                      <Popup>
                                          <StationPopupContent
                                              station={station}
                                              reading={
                                                  regionalFlowReadings[
                                                      stationKey
                                                  ]
                                              }
                                          />
                                      </Popup>
                                  </Marker>
                              );
                          })
                        : null}

                    {isLiveLocationEnabled && liveLocation && isLiveLocationPaneReady && (
                        <CircleMarker
                            center={[
                                liveLocation.latitude,
                                liveLocation.longitude,
                            ]}
                            radius={8}
                            pane={LIVE_LOCATION_PANE_NAME}
                            pathOptions={{
                                color: "#0284c7",
                                fillColor: "#38bdf8",
                                fillOpacity: 0.75,
                                weight: 2,
                            }}
                        />
                    )}
                </MapContainer>

                <button
                    type="button"
                    onClick={() => {
                        if (!mapInstance) return;
                        mapInstance.flyTo(RIVER_LUNE_CENTER, RIVER_LUNE_ZOOM, {
                            duration: 0.65,
                        });
                    }}
                    disabled={!mapInstance}
                    aria-label="Center map on the default location"
                    title="Center map"
                    style={{
                        ...floatingMapButtonStyle,
                        top: "86px",
                        left: "10px",
                        width: "38px",
                        height: "38px",
                        padding: "0",
                        justifyContent: "center",
                        alignItems: "center",
                        borderRadius: "10px",
                        background: "#ffffff",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                        border: "1px solid #e2e8f0",
                        cursor: mapInstance ? "pointer" : "not-allowed",
                        opacity: mapInstance ? 1 : 0.6,
                    }}
                >
                    <span
                        style={{
                            width: "16px",
                            height: "16px",
                            borderRadius: "999px",
                            border: "2px solid #0f172a",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        }}
                    >
                        <span
                            style={{
                                width: "5px",
                                height: "5px",
                                borderRadius: "999px",
                                background: "#0f172a",
                            }}
                        />
                    </span>
                </button>

                <button
                    type="button"
                    onClick={() => setIsLiveLocationEnabled((prev) => !prev)}
                    aria-label="Toggle live location"
                    title="Live location"
                    style={{
                        ...floatingMapButtonStyle,
                        top: "132px",
                        left: "10px",
                        width: "38px",
                        height: "38px",
                        padding: "0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "10px",
                        border: "1px solid #e2e8f0",
                        background: isLiveLocationEnabled
                            ? "#0ea5e9"
                            : "#ffffff",
                        color: isLiveLocationEnabled ? "#ffffff" : "#475569",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
                        transition: "all 0.2s ease",
                    }}
                >
                    {/* GPS Arrow Icon */}
                    <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill={isLiveLocationEnabled ? "currentColor" : "none"}
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{
                            transform: isLiveLocationEnabled
                                ? "rotate(0deg)"
                                : "rotate(-45deg)",
                            transition: "transform 0.2s ease",
                        }}
                    >
                        <polygon points="12 2 19 21 12 17 5 21 12 2" />
                    </svg>
                </button>

                {isMobile ? (
                    <button
                        type="button"
                        onClick={() => {
                            setIsFilterSheetOpen(true);
                            setIsMapToolsOpen(false);
                        }}
                        style={{
                            top: "10px",
                            right: "10px",
                            ...floatingMapButtonStyle,
                        }}
                    >
                        <span>Filters</span>
                        {activeFilterCount > 0 ? (
                            <span
                                style={{
                                    minWidth: "18px",
                                    height: "18px",
                                    borderRadius: "999px",
                                    background: "#0ea5e9",
                                    color: "#fff",
                                    fontSize: "0.72rem",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    padding: "0 5px",
                                    boxSizing: "border-box",
                                }}
                            >
                                {activeFilterCount}
                            </span>
                        ) : null}
                    </button>
                ) : (
                    <FilterControls
                        isMobile={isMobile}
                        controlFontSize={controlFontSize}
                        typeFilter={typeFilter}
                        statusFilter={statusFilter}
                        isLuneStationsVisible={isLuneStationsVisible}
                        isRegionalFlowStationsVisible={
                            isRegionalFlowStationsVisible
                        }
                        isContributorsVisible={isContributorsVisible}
                        setIsLuneStationsVisible={setIsLuneStationsVisible}
                        setIsRegionalFlowStationsVisible={
                            setIsRegionalFlowStationsVisible
                        }
                        setIsContributorsVisible={setIsContributorsVisible}
                        setTypeFilter={setTypeFilter}
                        setStatusFilter={setStatusFilter}
                        isOverlay
                    />
                )}

                {isDeferredUiReady ? (
                    <Suspense fallback={null}>
                        <LazyFloodStatusPanel
                            floodAlerts={floodAlerts}
                            isLoadingFloodAlerts={isLoadingFloodAlerts}
                            floodAlertsError={floodAlertsError}
                            floodAlertsUpdatedAt={floodAlertsUpdatedAt}
                            isMobile={isMobile}
                            uiTokens={UI_TOKENS}
                            SurfaceCard={SurfaceCard}
                        />
                    </Suspense>
                ) : null}

                <div
                    style={{
                        position: "absolute",
                        bottom: isMobile ? "28px" : "22px",
                        left: "10px",
                        zIndex: 900,
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        alignItems: "flex-start",
                    }}
                >
                    <button
                        type="button"
                        onClick={() => setIsMapToolsOpen((prev) => !prev)}
                        aria-expanded={isMapToolsOpen}
                        style={{
                            border: "1px solid #cbd5e1",
                            background: "rgba(255,255,255,0.96)",
                            color: "#0f172a",
                            borderRadius: "999px",
                            padding: isMobile ? "8px 12px" : "6px 10px",
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            boxShadow: "0 8px 22px rgba(15,23,42,0.16)",
                        }}
                    >
                        <span>Map Select</span>
                        <span style={{ fontSize: "0.9em" }}>
                            {isMapToolsOpen ? "▾" : "▴"}
                        </span>
                    </button>

                    <SurfaceCard
                        style={{
                            width: isMobile ? "min(88vw, 300px)" : "280px",
                            padding: "10px",
                            display: "grid",
                            gap: "8px",
                            opacity: isMapToolsOpen ? 1 : 0,
                            transform: isMapToolsOpen
                                ? "translateY(0) scale(1)"
                                : "translateY(8px) scale(0.98)",
                            transformOrigin: "bottom left",
                            transition:
                                "opacity 180ms ease, transform 220ms ease",
                            pointerEvents: isMapToolsOpen ? "auto" : "none",
                        }}
                    >
                        {groupedWaybackReleases.length > 0 ? (
                            <label
                                style={{
                                    display: "grid",
                                    gap: "5px",
                                    fontSize: "0.75rem",
                                    color: "#475569",
                                    fontWeight: 700,
                                }}
                            >
                                <span>Imagery</span>
                                <select
                                    value={selectedWaybackId ?? ""}
                                    onChange={(e) =>
                                        setSelectedWaybackId(
                                            e.target.value
                                                ? Number(e.target.value)
                                                : null,
                                        )
                                    }
                                    style={{
                                        border: "1px solid #cbd5e1",
                                        borderRadius: "8px",
                                        padding: "7px 8px",
                                        background: "#fff",
                                        fontSize: "0.82rem",
                                    }}
                                >
                                    <option value="">Mapbox (Live)</option>
                                    {groupedWaybackReleases.map((group) => (
                                        <optgroup key={group.label} label={group.label}>
                                            {group.options.map((release) => (
                                                <option
                                                    key={release.releaseNum}
                                                    value={release.releaseNum}
                                                >
                                                    {formatWaybackOptionLabel(release)}
                                                </option>
                                            ))}
                                        </optgroup>
                                    ))}
                                </select>
                            </label>
                        ) : null}

                        {liveLocationError ? (
                            <div
                                style={{
                                    background: "rgba(254,226,226,0.96)",
                                    border: "1px solid #fecaca",
                                    borderRadius: "8px",
                                    padding: "6px 8px",
                                    fontSize: "0.72rem",
                                    color: "#991b1b",
                                    lineHeight: 1.25,
                                }}
                            >
                                {liveLocationError}
                            </div>
                        ) : null}
                    </SurfaceCard>
                </div>
            </div>

            {isReportConsentOpen ? (
                <>
                    <div
                        onClick={() => {
                            setIsReportConsentOpen(false);
                            setPendingReportLocation(null);
                        }}
                        style={{
                            position: "fixed",
                            inset: 0,
                            background: "rgba(2,6,23,0.42)",
                            zIndex: 1300,
                        }}
                    />
                    <SurfaceCard
                        style={{
                            position: "fixed",
                            zIndex: 1301,
                            left: isMobile ? "10px" : "50%",
                            right: isMobile ? "10px" : "auto",
                            top: isMobile ? "auto" : "50%",
                            bottom: isMobile
                                ? "calc(env(safe-area-inset-bottom, 0px) + 10px)"
                                : "auto",
                            transform: isMobile
                                ? "none"
                                : "translate(-50%, -50%)",
                            width: isMobile
                                ? "auto"
                                : "min(440px, calc(100vw - 32px))",
                            padding: isMobile ? "12px" : "14px",
                            borderColor: "#93c5fd",
                            background:
                                "linear-gradient(180deg, #ffffff 0%, #eff6ff 100%)",
                            boxShadow: "0 20px 44px rgba(15,23,42,0.24)",
                        }}
                    >
                        <div
                            style={{
                                fontSize: "1rem",
                                fontWeight: 800,
                                color: "#0f172a",
                                marginBottom: "8px",
                            }}
                        >
                            Share GPS to send a report
                        </div>
                        <p
                            style={{
                                margin: 0,
                                fontSize: "0.84rem",
                                color: "#334155",
                                lineHeight: 1.45,
                            }}
                        >
                            Reporting opens Facebook Messenger and includes map
                            coordinates. This app does not store the report
                            details.
                        </p>
                        <div
                            style={{
                                marginTop: "10px",
                                display: "flex",
                                gap: "8px",
                                flexWrap: "wrap",
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    setHasAcceptedReportConsent(true);
                                    setIsReportConsentOpen(false);
                                    if (pendingReportLocation) {
                                        setReportLocation(
                                            pendingReportLocation,
                                        );
                                    }
                                    setPendingReportLocation(null);
                                    setReportStatus("");
                                }}
                                style={{
                                    border: "1px solid #1877f2",
                                    background: "#1877f2",
                                    color: "#fff",
                                    borderRadius: "8px",
                                    padding: "9px 13px",
                                    fontSize: "0.82rem",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                            >
                                I understand, continue
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsReportConsentOpen(false);
                                    setPendingReportLocation(null);
                                }}
                                style={{
                                    border: "1px solid #cbd5e1",
                                    background: "#fff",
                                    color: "#475569",
                                    borderRadius: "8px",
                                    padding: "9px 13px",
                                    fontSize: "0.82rem",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                            >
                                Cancel
                            </button>
                        </div>
                    </SurfaceCard>
                </>
            ) : null}

            {isMobile && isFilterSheetOpen ? (
                <>
                    <div
                        onClick={() => setIsFilterSheetOpen(false)}
                        style={{
                            position: "fixed",
                            inset: 0,
                            background: "rgba(2,6,23,0.38)",
                            zIndex: 1200,
                            transition: "opacity 180ms ease",
                        }}
                    />
                    <SurfaceCard
                        style={{
                            position: "fixed",
                            left: "0",
                            right: "0",
                            bottom: "0",
                            zIndex: 1201,
                            borderTopLeftRadius: "16px",
                            borderTopRightRadius: "16px",
                            borderBottomLeftRadius: "0",
                            borderBottomRightRadius: "0",
                            padding:
                                "12px 12px calc(env(safe-area-inset-bottom, 0px) + 14px)",
                            transform: "translateY(0)",
                            transition:
                                "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                marginBottom: "8px",
                            }}
                        >
                            <strong
                                style={{
                                    color: "#0f172a",
                                    fontSize: "0.92rem",
                                }}
                            >
                                Filters
                            </strong>
                            <button
                                type="button"
                                onClick={() => setIsFilterSheetOpen(false)}
                                style={{
                                    border: "1px solid #cbd5e1",
                                    borderRadius: "999px",
                                    background: "#fff",
                                    width: "34px",
                                    height: "34px",
                                    fontWeight: 700,
                                }}
                                aria-label="Close filters"
                            >
                                ×
                            </button>
                        </div>

                        <FilterControls
                            isMobile={isMobile}
                            controlFontSize={controlFontSize}
                            typeFilter={typeFilter}
                            statusFilter={statusFilter}
                            isLuneStationsVisible={isLuneStationsVisible}
                            isRegionalFlowStationsVisible={
                                isRegionalFlowStationsVisible
                            }
                            isContributorsVisible={isContributorsVisible}
                            setIsLuneStationsVisible={setIsLuneStationsVisible}
                            setIsRegionalFlowStationsVisible={
                                setIsRegionalFlowStationsVisible
                            }
                            setIsContributorsVisible={setIsContributorsVisible}
                            setTypeFilter={setTypeFilter}
                            setStatusFilter={setStatusFilter}
                        />
                    </SurfaceCard>
                </>
            ) : null}

            {isMobile && selectedContributor ? (
                <ContributorMobileSheet
                    contributor={selectedContributor}
                    mapsUrl={selectedContributorMapsUrl}
                    onClose={() => setSelectedContributorId(null)}
                />
            ) : null}

            <ContributorBusinessPanel
                isOpen={isContributorPanelOpen}
                onClose={() => setIsContributorPanelOpen(false)}
                contributors={contributors}
                supabase={supabase}
                canManageItems={canManageItems}
                onContributorAdded={() => fetchContributors({ bypassTtl: true })}
                onContributorUpdated={() => fetchContributors({ bypassTtl: true })}
                onContributorDeleted={() => fetchContributors({ bypassTtl: true })}
            />

            <PoiPanel
                isOpen={isPoiPanelOpen}
                onClose={closePoiPanel}
                canManageItems={canManageItems}
                isMobile={isMobile}
                mode={editingHistoricalPoi ? "edit" : "create"}
                initialPoi={editingHistoricalPoi}
                onSavePoi={saveHistoricalPoi}
                onDeletePoi={deleteHistoricalPoi}
                onUploadPoiImage={uploadHistoricalPoiImage}
                onRefresh={fetchHistoricalPois}
                pendingLocation={pendingLocation}
            />

            {selectedHistoricalPoi ? (
                <PoiCard
                    poi={selectedHistoricalPoi}
                    onClose={() => setSelectedHistoricalPoiId(null)}
                    onEdit={openPoiEditPanel}
                    isMobile={isMobile}
                    canManage={canManageItems}
                    shareUrl={selectedHistoricalPoiPublicUrl}
                    isTidePlannerCollapsed={isTidePlannerCollapsed}
                />
            ) : null}

            <Suspense fallback={null}>
                <LazySelectedItemDrawer
                    selectedItem={selectedItem}
                    selectedCounts={selectedCounts}
                    selectedStory={selectedStory}
                    selectedGps={selectedGps}
                    selectedGeoLookup={selectedGeoLookup}
                    isResolvingGeoLookup={isResolvingGeoLookup}
                    selectedMapsUrl={selectedMapsUrl}
                    selectedWeight={selectedWeight}
                    editingItemId={editingItemId}
                    editForm={editForm}
                    isUpdatingItemId={isUpdatingItemId}
                    isMobile={isMobile}
                    setSelectedItemId={setSelectedItemId}
                    setEditingItemId={setEditingItemId}
                    setEditForm={setEditForm}
                    setIsImageViewerOpen={setIsImageViewerOpen}
                    saveItemEdits={saveItemEdits}
                    removeLocation={removeLocation}
                    startEditingItem={startEditingItem}
                    canManageItems={canManageItems}
                    markItemRecovered={markItemRecovered}
                    lastSaveResult={lastSaveResult}
                    onUploadReferenceImage={uploadReferenceImageFromEdit}
                    isUploadingReferenceImage={isUploadingReferenceImage}
                    onCopyShareLink={copyShareLinkForItem}
                    copiedShareItemId={copiedShareItemId}
                    shareCopyStatus={shareCopyStatus}
                    TYPE_LABELS={TYPE_LABELS}
                    normalizeType={normalizeType}
                    formatTimeInRiver={formatTimeInRiver}
                    isItemStoryEmpty={isItemStoryEmpty}
                    formatStoryDate={formatStoryDate}
                    DetailBadge={DetailBadge}
                    formatWeightKg={formatWeightKg}
                    LocationDetailsBlock={LocationDetailsBlock}
                    getDefaultWeightForType={getDefaultWeightForType}
                    parseEstimatedWeightKg={parseEstimatedWeightKg}
                    clampInt={clampInt}
                    normalizeOptionalDateInput={normalizeOptionalDateInput}
                />
            </Suspense>

            <Suspense fallback={null}>
                <LazyFullscreenImageViewer
                    isOpen={isImageViewerOpen}
                    isMobile={isMobile}
                    selectedItem={selectedItem}
                    selectedCounts={selectedCounts}
                    selectedStory={selectedStory}
                    selectedGps={selectedGps}
                    selectedGeoLookup={selectedGeoLookup}
                    isResolvingGeoLookup={isResolvingGeoLookup}
                    selectedMapsUrl={selectedMapsUrl}
                    onClose={() => setIsImageViewerOpen(false)}
                    TYPE_LABELS={TYPE_LABELS}
                    normalizeType={normalizeType}
                    formatStoryDate={formatStoryDate}
                    formatTimeInRiver={formatTimeInRiver}
                    LocationDetailsBlock={LocationDetailsBlock}
                />
            </Suspense>
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
