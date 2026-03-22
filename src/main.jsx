import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { createPortal } from "react-dom";
import {
    MapContainer,
    TileLayer,
    Marker,
    CircleMarker,
    useMap,
    useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import * as exifr from "exifr";
import "leaflet/dist/leaflet.css";
import { supabase } from "./supabaseClient";

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
// River Lune, Lancaster — adjust if needed
const RIVER_LUNE_CENTER = [54.0495, -2.7995];
const RIVER_LUNE_ZOOM = 15;

const TYPE_LABELS = {
    bike: "Bike",
    motorbike: "Motorbike",
    trolley: "Trolley",
    misc: "Misc",
};

const ASSUMED_ITEM_WEIGHTS_KG = {
    trolley: 28,
    bike: 15,
    motorbike: 180,
    misc: 30,
};
const CONSERVATIVE_SCRAP_VALUE_GBP_PER_KG = {
    min: 0.08,
    max: 0.15,
};

const formatGbp = (value) => `£${value.toFixed(2)}`;

const ITEMS_STORAGE_KEY = "cleanup-items-v1";
const COUNT_STORAGE_KEY = "cleanup-item-counts-v1";
const GPS_STORAGE_KEY = "cleanup-item-gps-v1";
const WEIGHT_STORAGE_KEY = "cleanup-item-weights-v1";
const GEOLOOKUP_STORAGE_KEY = "cleanup-item-geolookup-v1";
const LANCASTER_TIDE_JSON_URL = `${import.meta.env.BASE_URL}lancaster-tides.json`;
const LANCASTER_TIDE_CHART_URL =
    "https://www.tide-forecast.com/tide/Lancaster/tide-times";
const TIDE_CHART_MIN_WIDTH = 640;
const TIDE_CHART_PIXELS_PER_POINT = 120;
const CLEANUP_WINDOW_MINUTES = 120;
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

const inferDbGeoFieldSupport = (items) => {
    const first = Array.isArray(items) ? items[0] : null;

    return {
        label: first ? Object.prototype.hasOwnProperty.call(first, "geocode_label") : null,
        postcode: first ? Object.prototype.hasOwnProperty.call(first, "geocode_postcode") : null,
        countryCode: first ? Object.prototype.hasOwnProperty.call(first, "geocode_country_code") : null,
        source: first ? Object.prototype.hasOwnProperty.call(first, "geocode_source") : null,
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
        baselineY: padding.top + chartHeight,
        medianY: getY(medianHeight),
        points,
        curvePath,
        areaPath,
        cleanupWindows,
    };
};

const extractGpsFromImage = async (file) => {
    try {
        const gps = await exifr.gps(file);
        if (!gps) return null;

        const latitude = parseGpsNumber(gps.latitude);
        const longitude = parseGpsNumber(gps.longitude);

        if (latitude === null || longitude === null) return null;
        if (latitude < -90 || latitude > 90) return null;
        if (longitude < -180 || longitude > 180) return null;

        return {
            latitude,
            longitude,
        };
    } catch {
        return null;
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
        motorbike: "🏍️",
        trolley: "🛒",
        misc: "🧰",
    };

    const colors = {
        bike: "#3498db",
        motorbike: "#dc2626",
        trolley: "#e67e22",
        misc: "#7f8c8d",
    };

    const baseColor = colors[normalizedType] || colors.misc;
    const emoji = iconMap[normalizedType] || iconMap.misc;
    const ringColor = isRecovered ? "#2ecc71" : baseColor;
    const opacity = isRecovered ? 0.8 : 1;

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
                        Defaults to {formatWeightKg(getDefaultWeightForType(pendingItemType))} for {TYPE_LABELS[pendingItemType].toLowerCase()}s.
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
                        href="https://ko-fi.com/rowdog"
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
    authReady,
    currentUser,
    canManageItems,
    isAuthActionLoading,
    onSignIn,
    onSignOut,
    isLoadingItems,
}) {
    const signedIn = Boolean(currentUser);
    const syncLabel = isLoadingItems ? "Syncing" : "Up to date";

    return (
        <div
            style={{
                position: "sticky",
                top: `calc(env(safe-area-inset-top, 0px) + ${isMobile ? "2px" : "0px"})`,
                zIndex: 1050,
                marginBottom: UI_TOKENS.spacing.sm,
                padding: isMobile ? "8px 10px" : "9px 12px",
                borderRadius: UI_TOKENS.radius.md,
                border: "1px solid rgba(148,163,184,0.35)",
                background: "rgba(255,255,255,0.86)",
                backdropFilter: "blur(16px)",
                boxShadow: UI_TOKENS.shadow.soft,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
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
                `}
            </style>
            <div style={{ minWidth: 0 }}>
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
                <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "2px", fontSize: "0.72rem", color: "#475569" }}>
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

            <div
                style={{ display: "flex", alignItems: "center", gap: "6px" }}
            >
                <a
                    href="https://ko-fi.com/rowdog"
                    target="_blank"
                    rel="noreferrer"
                    style={{
                        border: "1px solid #bfdbfe",
                        background: "#eff6ff",
                        color: "#1d4ed8",
                        borderRadius: UI_TOKENS.radius.pill,
                        minHeight: "34px",
                        padding: isMobile ? "0 10px" : "0 11px",
                        fontSize: "0.74rem",
                        fontWeight: 700,
                        textDecoration: "none",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        whiteSpace: "nowrap",
                    }}
                    aria-label="Support cleanup costs on Ko-fi"
                >
                    {isMobile ? "❤" : "❤ Support"}
                </a>

                <button
                    type="button"
                    onClick={signedIn ? onSignOut : onSignIn}
                    disabled={!authReady || isAuthActionLoading}
                    style={{
                        border: `1px solid ${signedIn ? "#cbd5e1" : "#0f172a"}`,
                        background: signedIn ? "#fff" : "#0f172a",
                        color: signedIn ? "#0f172a" : "#fff",
                        borderRadius: UI_TOKENS.radius.pill,
                        minHeight: "34px",
                        padding: isMobile ? "0 11px" : "0 12px",
                        fontSize: "0.76rem",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        opacity: !authReady || isAuthActionLoading ? 0.65 : 1,
                        cursor: !authReady || isAuthActionLoading ? "not-allowed" : "pointer",
                    }}
                >
                    {signedIn ? "Sign Out" : "Sign In"}
                </button>
            </div>
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
    const trolleyWeight = ASSUMED_ITEM_WEIGHTS_KG.trolley;
    const bikeWeight = ASSUMED_ITEM_WEIGHTS_KG.bike;
    const motorbikeWeight = ASSUMED_ITEM_WEIGHTS_KG.motorbike;
    const miscWeight = ASSUMED_ITEM_WEIGHTS_KG.misc;
    const totalTrolley = impactStats.totalByType.trolley;
    const totalBike = impactStats.totalByType.bike;
    const totalMotorbike = impactStats.totalByType.motorbike;
    const totalMisc = impactStats.totalByType.misc;
    const recoveredTrolley = impactStats.recoveredByType.trolley;
    const recoveredBike = impactStats.recoveredByType.bike;
    const recoveredMotorbike = impactStats.recoveredByType.motorbike;
    const recoveredMisc = impactStats.recoveredByType.misc;
    const remainingTrolley = impactStats.remainingByType.trolley;
    const remainingBike = impactStats.remainingByType.bike;
    const remainingMotorbike = impactStats.remainingByType.motorbike;
    const remainingMisc = impactStats.remainingByType.misc;
    const remainingScrapValueMin = impactStats.estimatedRemainingKg * CONSERVATIVE_SCRAP_VALUE_GBP_PER_KG.min;
    const remainingScrapValueMax = impactStats.estimatedRemainingKg * CONSERVATIVE_SCRAP_VALUE_GBP_PER_KG.max;
    const recoveredScrapValueMin = impactStats.estimatedRecoveredKg * CONSERVATIVE_SCRAP_VALUE_GBP_PER_KG.min;
    const recoveredScrapValueMax = impactStats.estimatedRecoveredKg * CONSERVATIVE_SCRAP_VALUE_GBP_PER_KG.max;

    useEffect(() => {
        if (!activeTooltip) return undefined;

        const handlePointerDown = (event) => {
            if (!statsRef.current?.contains(event.target)) {
                setActiveTooltip(null);
            }
        };

        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [activeTooltip]);

    const totalTooltipLines = [
        "Total items consist of:",
        `${totalTrolley} trolleys`,
        `${totalBike} bikes`,
        `${totalMotorbike} motorbikes`,
        `${totalMisc} misc`,
        `Total = ${totals.total} items`,
    ];

    const recoveredTooltipLines = [
        "Recovered items consist of:",
        `${recoveredTrolley} trolleys`,
        `${recoveredBike} bikes`,
        `${recoveredMotorbike} motorbikes`,
        `${recoveredMisc} misc`,
        `Total = ${totals.recovered} items`,
    ];

    const remainingTooltipLines = [
        "Remaining items consist of:",
        `${remainingTrolley} trolleys`,
        `${remainingBike} bikes`,
        `${remainingMotorbike} motorbikes`,
        `${remainingMisc} misc`,
        `Total = ${totals.remaining} items`,
    ];

    const locationsTooltipLines = [
        "Locations currently visible:",
        `${locationCount} mapped points after filters`,
    ];

    const remainingWeightTooltipLines = [
        "Estimated remaining weight workings:",
        `${remainingTrolley} trolleys, ${formatWeightKg(impactStats.remainingWeightByType.trolley)} total (${formatWeightKg(trolleyWeight)} default each)`,
        `${remainingBike} bikes, ${formatWeightKg(impactStats.remainingWeightByType.bike)} total (${formatWeightKg(bikeWeight)} default each)`,
        `${remainingMotorbike} motorbikes, ${formatWeightKg(impactStats.remainingWeightByType.motorbike)} total (${formatWeightKg(motorbikeWeight)} default each)`,
        `${remainingMisc} misc, ${formatWeightKg(impactStats.remainingWeightByType.misc)} total (${formatWeightKg(miscWeight)} default each)`,
        `Total = ${formatWeightKg(Math.round(impactStats.estimatedRemainingKg))}`,
        "Conservative scrap value estimate:",
        `${formatGbp(remainingScrapValueMin)} to ${formatGbp(remainingScrapValueMax)} (£0.08-£0.15 per kg)`,
    ];

    const removedWeightTooltipLines = [
        "Estimated removed weight workings:",
        `${recoveredTrolley} trolleys, ${formatWeightKg(impactStats.recoveredWeightByType.trolley)} total (${formatWeightKg(trolleyWeight)} default each)`,
        `${recoveredBike} bikes, ${formatWeightKg(impactStats.recoveredWeightByType.bike)} total (${formatWeightKg(bikeWeight)} default each)`,
        `${recoveredMotorbike} motorbikes, ${formatWeightKg(impactStats.recoveredWeightByType.motorbike)} total (${formatWeightKg(motorbikeWeight)} default each)`,
        `${recoveredMisc} misc, ${formatWeightKg(impactStats.recoveredWeightByType.misc)} total (${formatWeightKg(miscWeight)} default each)`,
        `Total = ${formatWeightKg(Math.round(impactStats.estimatedRecoveredKg))}`,
        "Conservative scrap value estimate:",
        `${formatGbp(recoveredScrapValueMin)} to ${formatGbp(recoveredScrapValueMax)} (£0.08-£0.15 per kg)`,
    ];

    const desktopRightAlignedTooltipIds = new Set(["remaining-weight", "removed-weight"]);
    const mobileRightAlignedTooltipIds = new Set(["recovered-items", "locations", "removed-weight"]);

    const renderStatTile = (id, label, valueNode, tooltipLines, valueColor) => {
        const alignTooltipRight = isMobile
            ? mobileRightAlignedTooltipIds.has(id)
            : desktopRightAlignedTooltipIds.has(id);

        return (
            <button
                type="button"
                onClick={() => setActiveTooltip((prev) => (prev === id ? null : id))}
                onMouseEnter={() => {
                    if (!isMobile) setActiveTooltip(id);
                }}
                onMouseLeave={() => {
                    if (!isMobile) setActiveTooltip((prev) => (prev === id ? null : prev));
                }}
                style={{
                    position: "relative",
                    width: "100%",
                    border: "1px solid #dbe4ee",
                    background: activeTooltip === id ? "#eff6ff" : "rgba(255,255,255,0.84)",
                    borderRadius: UI_TOKENS.radius.sm,
                    padding: isMobile ? "8px 10px" : "7px 10px",
                    textAlign: "left",
                    color: "#0f172a",
                    cursor: "help",
                    boxShadow: activeTooltip === id ? "0 10px 24px rgba(37,99,235,0.12)" : "none",
                    minWidth: 0,
                    minHeight: isMobile ? "auto" : "44px",
                }}
                aria-expanded={activeTooltip === id}
                aria-label={`${label}. Tap or hover for breakdown.`}
            >
                <span style={{ display: "block", paddingRight: "18px" }}>
                    {label}: <strong style={valueColor ? { color: valueColor } : undefined}>{valueNode}</strong>
                </span>
                <span
                    aria-hidden="true"
                    style={{
                        position: "absolute",
                        top: "7px",
                        right: "8px",
                        width: "16px",
                        height: "16px",
                        borderRadius: "999px",
                        background: activeTooltip === id ? "#2563eb" : "#cbd5e1",
                        color: activeTooltip === id ? "#fff" : "#334155",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "0.7rem",
                        fontWeight: 700,
                    }}
                >
                    i
                </span>
                {activeTooltip === id ? (
                    <div
                        style={{
                            position: "absolute",
                            top: "calc(100% + 8px)",
                            bottom: "auto",
                            left: alignTooltipRight ? "auto" : 0,
                            right: alignTooltipRight ? 0 : "auto",
                            zIndex: 1600,
                            width: isMobile ? "min(240px, calc(100vw - 24px))" : "260px",
                            maxWidth: "calc(100vw - 24px)",
                            padding: "10px 11px",
                            borderRadius: UI_TOKENS.radius.sm,
                            border: "1px solid #cbd5e1",
                            background: "rgba(255,255,255,0.98)",
                            boxShadow: UI_TOKENS.shadow.raised,
                            color: "#334155",
                            fontSize: "0.78rem",
                            lineHeight: 1.45,
                            whiteSpace: "pre-line",
                        }}
                    >
                        {tooltipLines.map((line) => (
                            <div
                                key={`${id}-${line}`}
                                style={{ fontWeight: line.endsWith(":") ? 700 : 500, marginBottom: line.endsWith(":") ? "4px" : "0" }}
                            >
                                {line}
                            </div>
                        ))}
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

    return (
        <div ref={statsRef}>
            <SurfaceCard
            style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(6, minmax(0, 1fr))",
                gap: "8px",
                marginTop: "0px",
                marginBottom: "4px",
                padding: isMobile ? "6px 8px" : "6px 10px",
                background: "linear-gradient(180deg, #ffffff, #f8fafc)",
                border: "1px solid #e2e8f0",
                fontSize: controlFontSize,
            }}
            >
                {renderStatTile("total-items", "Total Items", totals.total, totalTooltipLines)}
                {renderStatTile("recovered-items", "Recovered", totals.recovered, recoveredTooltipLines, "green")}
                {renderStatTile("remaining-items", "Remaining", totals.remaining, remainingTooltipLines, "red")}
                {renderStatTile("locations", "Locations", locationCount, locationsTooltipLines, "#2c3e50")}
                {renderStatTile("remaining-weight", "Est. Weight Remaining", remainingKgLabel, remainingWeightTooltipLines, "#b45309")}
                {renderStatTile("removed-weight", "Est. Weight Removed", recoveredKgLabel, removedWeightTooltipLines, "#0f766e")}
            </SurfaceCard>
        </div>
    );
}

function ControlToggles({
    isMobile,
    isTidePlannerCollapsed,
    onToggleTidePlanner,
}) {
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                flexWrap: "wrap",
                marginTop: "4px",
                marginBottom: isTidePlannerCollapsed ? "2px" : "8px",
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
                    gap: "6px",
                    flexWrap: "wrap",
                    justifyContent: isMobile ? "flex-start" : "flex-end",
                }}
            >
                <button
                    onClick={onToggleTidePlanner}
                    style={{
                        border: "1px solid #cbd5e1",
                        background: "linear-gradient(135deg, #eff6ff, #f8fafc)",
                        color: "#0f172a",
                        borderRadius: UI_TOKENS.radius.pill,
                        padding: isMobile ? "7px 10px" : "5px 10px",
                        minHeight: "30px",
                        width: "auto",
                        fontSize: "0.8rem",
                        fontWeight: 700,
                        letterSpacing: "0.01em",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        boxShadow: "0 4px 16px rgba(15,23,42,0.08)",
                        cursor: "pointer",
                    }}
                    aria-expanded={!isTidePlannerCollapsed}
                    aria-label={isTidePlannerCollapsed ? "Show tide planner" : "Hide tide planner"}
                >
                    <span>{isTidePlannerCollapsed ? "Show Tide Planner" : "Hide Tide Planner"}</span>
                    <span style={{ fontSize: "0.9em" }}>{isTidePlannerCollapsed ? "▾" : "▴"}</span>
                </button>
            </div>
        </div>
    );
}

function FilterControls({
    isMobile,
    controlFontSize,
    typeFilter,
    statusFilter,
    setTypeFilter,
    setStatusFilter,
    isOverlay = false,
}) {
    const typeOptions = [
        { value: "all", label: "All" },
        { value: "bike", label: "Bike" },
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

    return (
        <div
            style={{
                ...(isOverlay
                    ? {
                          position: "absolute",
                          top: isMobile ? "8px" : "10px",
                          right: isMobile ? "8px" : "10px",
                          zIndex: 700,
                          maxWidth: isMobile ? "min(84vw, 240px)" : "250px",
                      }
                    : {}),
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexWrap: isOverlay ? "nowrap" : isMobile ? "nowrap" : "wrap",
                    flexDirection: isOverlay ? "column" : isMobile ? "column" : "row",
                    gap: isOverlay ? "7px" : "8px",
                    marginBottom: isOverlay ? "0" : "8px",
                    marginTop: isOverlay ? "0" : "8px",
                    alignItems: isOverlay ? "stretch" : isMobile ? "stretch" : "center",
                    padding: isOverlay ? (isMobile ? "7px" : "8px") : "0",
                    borderRadius: isOverlay ? "6px" : "0",
                    border: isOverlay ? "2px solid rgba(0,0,0,0.2)" : "none",
                    background: isOverlay ? "rgba(255,255,255,0.97)" : "transparent",
                    boxShadow: isOverlay ? "0 1px 5px rgba(0,0,0,0.4)" : "none",
                }}
            >
                {isOverlay ? (
                    <div
                        style={{
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            color: "#475569",
                            letterSpacing: "0.06em",
                            textTransform: "uppercase",
                            marginBottom: "1px",
                        }}
                    >
                        Filters
                    </div>
                ) : null}

                {useSegmentedMobile ? (
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
                    </>
                ) : (
                    <>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexDirection: isOverlay ? "column" : "row" }}>
                            <span style={{ fontSize: isOverlay ? "0.72rem" : controlFontSize, fontWeight: 600, alignSelf: isOverlay ? "flex-start" : "auto" }}>Type:</span>
                            <select
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value)}
                                style={{
                                    border: isOverlay ? "1px solid #9ca3af" : "1px solid #cbd5e1",
                                    borderRadius: isOverlay ? "4px" : "8px",
                                    padding: isOverlay ? "6px 8px" : isMobile ? "9px 10px" : "5px 8px",
                                    fontSize: isOverlay ? "0.78rem" : controlFontSize,
                                    background: "#fff",
                                    minHeight: isOverlay ? "30px" : isMobile ? "40px" : "32px",
                                    width: isOverlay ? "100%" : isMobile ? "100%" : "auto",
                                }}
                            >
                                <option value="all">All</option>
                                <option value="bike">Bikes</option>
                                <option value="motorbike">Motorbikes</option>
                                <option value="trolley">Trolleys</option>
                                <option value="misc">Misc</option>
                            </select>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexDirection: isOverlay ? "column" : "row" }}>
                            <span style={{ fontSize: isOverlay ? "0.72rem" : controlFontSize, fontWeight: 600, alignSelf: isOverlay ? "flex-start" : "auto" }}>Status:</span>
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                style={{
                                    border: isOverlay ? "1px solid #9ca3af" : "1px solid #cbd5e1",
                                    borderRadius: isOverlay ? "4px" : "8px",
                                    padding: isOverlay ? "6px 8px" : isMobile ? "9px 10px" : "5px 8px",
                                    fontSize: isOverlay ? "0.78rem" : controlFontSize,
                                    background: "#fff",
                                    minHeight: isOverlay ? "30px" : isMobile ? "40px" : "32px",
                                    width: isOverlay ? "100%" : isMobile ? "100%" : "auto",
                                }}
                            >
                                <option value="all">All</option>
                                <option value="in-water">In Water</option>
                                <option value="recovered">Recovered</option>
                            </select>
                        </div>
                    </>
                )}
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

    const selectedTidePoint =
        tideChartData?.points?.find((point) => point.index === selectedTideIndex) ||
        nextTide ||
        tideChartData?.points?.[0] ||
        null;

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

                    <div style={{ fontSize: "0.8rem", color: "#334155", marginBottom: "5px", lineHeight: 1.35 }}>
                        Best cleanup window is usually around low tide: target about 2 hours before and after the low tide dips shown on the graph.
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

                                <div style={{ width: "100%", overflowX: "auto", marginTop: "-3px", marginBottom: "-2px" }}>
                                    <svg
                                        viewBox={`0 0 ${tideChartData.width} ${tideChartData.height}`}
                                        role="img"
                                        aria-label="Wave graph of upcoming Lancaster tide highs, lows, and current time"
                                        style={{ width: "100%", minWidth: `${tideChartData.width}px`, height: "auto", display: "block" }}
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

                                        {tideChartData.cleanupWindows.map((window) => (
                                            <g key={`cleanup-window-${window.index}`}>
                                                <rect
                                                    x={window.xStart}
                                                    y={tideChartData.padding.top}
                                                    width={Math.max(window.xEnd - window.xStart, 1)}
                                                    height={tideChartData.baselineY - tideChartData.padding.top}
                                                    fill="rgba(22, 163, 74, 0.11)"
                                                />
                                                <line
                                                    x1={window.xStart}
                                                    x2={window.xStart}
                                                    y1={tideChartData.padding.top}
                                                    y2={tideChartData.baselineY}
                                                    stroke="rgba(22, 163, 74, 0.6)"
                                                    strokeWidth="1"
                                                    strokeDasharray="5 5"
                                                />
                                                <line
                                                    x1={window.xEnd}
                                                    x2={window.xEnd}
                                                    y1={tideChartData.padding.top}
                                                    y2={tideChartData.baselineY}
                                                    stroke="rgba(22, 163, 74, 0.6)"
                                                    strokeWidth="1"
                                                    strokeDasharray="5 5"
                                                />
                                            </g>
                                        ))}

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
    selectedGps,
    selectedGeoLookup,
    isResolvingGeoLookup,
    selectedMapsUrl,
    onClose,
}) {
    if (!isOpen || !selectedItem?.image_url || !selectedCounts) return null;

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
            <button
                onClick={onClose}
                style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
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

            <img
                src={selectedItem.image_url}
                alt="Debris evidence full size"
                style={{
                    maxWidth: "100%",
                    maxHeight: "100%",
                    objectFit: "contain",
                }}
            />

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

                    <LocationDetailsBlock
                        gps={selectedGps}
                        geoLookup={selectedGeoLookup}
                        isResolving={isResolvingGeoLookup}
                        mapsUrl={selectedMapsUrl}
                        mapPoint={{ latitude: selectedItem.y, longitude: selectedItem.x }}
                        compact
                        inverted
                    />
                </div>
            </div>
        </div>
    );

    return createPortal(viewerNode, document.body);
}

function SelectedItemDrawer({
    selectedItem,
    selectedCounts,
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
    const itemTypeLabel = TYPE_LABELS[normalizeType(selectedItem.type)];
    const itemStatusLabel = selectedCounts.isRecovered ? "Recovered" : "In Water";
    const shareButtonLabel = copiedShareItemId === selectedItem.id && shareCopyStatus ? "Copied" : "Share";
    const useDenseDesktopCard = !useBottomSheet && !isEditingThisItem;

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
                                background: "#eff6ff",
                                border: "1px solid #dbeafe",
                                color: "#1d4ed8",
                                fontSize: "0.68rem",
                                fontWeight: 700,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    width: "7px",
                                    height: "7px",
                                    borderRadius: "999px",
                                    background: selectedCounts.isRecovered ? "#22c55e" : "#f59e0b",
                                    boxShadow: selectedCounts.isRecovered
                                        ? "0 0 0 4px rgba(34,197,94,0.14)"
                                        : "0 0 0 4px rgba(245,158,11,0.14)",
                                }}
                            />
                            Cleanup Item
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
                                        src={selectedItem.image_url}
                                        alt="Debris evidence"
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

function App() {
    const detectMobileViewport = () => {
        if (typeof window === "undefined") return false;

        const smallViewport = window.matchMedia("(max-width: 1024px)").matches;
        const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
        return smallViewport || coarsePointer;
    };

    const [items, setItems] = useState(() => readStoredJson(ITEMS_STORAGE_KEY, [], Array.isArray));
    const [typeFilter, setTypeFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [pendingLocation, setPendingLocation] = useState(null);
    const [pendingItemType, setPendingItemType] = useState(null);
    const [isSavingItem, setIsSavingItem] = useState(false);
    const [isPickingImage, setIsPickingImage] = useState(false);
    const [uploadProgressText, setUploadProgressText] = useState("");
    const [pendingCount, setPendingCount] = useState(1);
    const [editingItemId, setEditingItemId] = useState(null);
    const [editForm, setEditForm] = useState({ type: "misc", total: 1, recovered: 0, estimatedWeight: String(getDefaultWeightForType("misc")), lat: "", lng: "" });
    const [isUpdatingItemId, setIsUpdatingItemId] = useState(null);
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [querySelectedItemId, setQuerySelectedItemId] = useState(() => readSelectedItemIdFromQuery());
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
    const [localCounts, setLocalCounts] = useState(() =>
        readStoredJson(COUNT_STORAGE_KEY, {}, (value) => value && typeof value === "object" && !Array.isArray(value)),
    );
    const [localGps, setLocalGps] = useState(() =>
        readStoredJson(GPS_STORAGE_KEY, {}, (value) => value && typeof value === "object" && !Array.isArray(value)),
    );
    const [localWeights, setLocalWeights] = useState(() =>
        readStoredJson(WEIGHT_STORAGE_KEY, {}, (value) => value && typeof value === "object" && !Array.isArray(value)),
    );
    const [localGeoLookup, setLocalGeoLookup] = useState(() =>
        readStoredJson(GEOLOOKUP_STORAGE_KEY, {}, (value) => value && typeof value === "object" && !Array.isArray(value)),
    );
    const [isResolvingGeoLookup, setIsResolvingGeoLookup] = useState(false);
    const [dbCountFieldSupport, setDbCountFieldSupport] = useState(() =>
        inferDbCountFieldSupport(readStoredJson(ITEMS_STORAGE_KEY, [], Array.isArray)),
    );
    const [dbGpsFieldSupport, setDbGpsFieldSupport] = useState(() =>
        inferDbGpsFieldSupport(readStoredJson(ITEMS_STORAGE_KEY, [], Array.isArray)),
    );
    const [dbWeightFieldSupport, setDbWeightFieldSupport] = useState(() =>
        inferDbWeightFieldSupport(readStoredJson(ITEMS_STORAGE_KEY, [], Array.isArray)),
    );
    const [dbGeoFieldSupport, setDbGeoFieldSupport] = useState(() =>
        inferDbGeoFieldSupport(readStoredJson(ITEMS_STORAGE_KEY, [], Array.isArray)),
    );
    const [isMobile, setIsMobile] = useState(detectMobileViewport);
    const [waybackReleases, setWaybackReleases] = useState([]);
    const [selectedWaybackId, setSelectedWaybackId] = useState(null);
    const [isLiveLocationEnabled, setIsLiveLocationEnabled] = useState(false);
    const [liveLocation, setLiveLocation] = useState(null);
    const [liveLocationError, setLiveLocationError] = useState("");
    const [pendingEstimatedWeight, setPendingEstimatedWeight] = useState("");
    const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
    const [isMapToolsOpen, setIsMapToolsOpen] = useState(false);
    const [copiedShareItemId, setCopiedShareItemId] = useState(null);
    const [shareCopyStatus, setShareCopyStatus] = useState("");
    const ignoreNextMapClickRef = useRef(false);
    const mapOverlayRootRef = useRef(null);
    const liveLocationWatchIdRef = useRef(null);
    const liveLocationBestRef = useRef(null);
    const geocodeAttemptedKeysRef = useRef(new Set());
    const shareCopyTimeoutRef = useRef(null);
    const canManageItems = useMemo(() => canUserManageItems(currentUser), [currentUser]);

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

    const markOverlayInteraction = () => {
        ignoreNextMapClickRef.current = true;

        window.setTimeout(() => {
            ignoreNextMapClickRef.current = false;
        }, 0);
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
                // Sort most-recent first; keep up to 80 snapshots
                const sorted = [...list]
                    .filter((r) => r.releaseNum)
                    .sort((a, b) => b.releaseNum - a.releaseNum)
                    .slice(0, 80);
                setWaybackReleases(sorted);
                // Default to the latest World Imagery snapshot
                if (sorted.length > 0) setSelectedWaybackId(sorted[0].releaseNum);
            })
            .catch(() => {});
    }, []);

    useEffect(() => {
        fetchItems();
    }, []);

    useEffect(() => {
        let isMounted = true;

        const initAuth = async () => {
            const { data, error } = await supabase.auth.getUser();

            if (!isMounted) return;

            if (error) {
                setAuthError("Unable to check sign-in state right now.");
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
        if (canManageItems) return;

        setPendingLocation(null);
        setPendingItemType(null);
        setEditingItemId(null);
    }, [canManageItems]);

    useEffect(() => {
        if (!pendingLocation) return;
        setIsFilterSheetOpen(false);
        setIsMapToolsOpen(false);
    }, [pendingLocation]);

    useEffect(() => {
        fetchLancasterTides();
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
                source: "exif",
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
            source: "exif",
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

    async function fetchItems() {
        setIsLoadingItems(true);
        const { data, error } = await supabase.from("items").select("*");

        if (error) {
            setIsLoadingItems(false);
            return false;
        }

        const nextItems = data || [];
        setDbCountFieldSupport(inferDbCountFieldSupport(nextItems));
        setDbGpsFieldSupport(inferDbGpsFieldSupport(nextItems));
        setDbWeightFieldSupport(inferDbWeightFieldSupport(nextItems));
        setDbGeoFieldSupport(inferDbGeoFieldSupport(nextItems));
        setItems(nextItems);
        setIsLoadingItems(false);
        return true;
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
        const fileExt = file.name.split(".").pop();
        const fileName = `${Math.random()}.${fileExt}`;
        const filePath = `${fileName}`;

    // Upload the file to the Supabase Bucket
        const { error: uploadError } = await supabase.storage
            .from("debris-images")
            .upload(filePath, file);

        if (uploadError) throw uploadError;

        // 2. Get the Public URL
        const { data } = supabase.storage
            .from("debris-images")
            .getPublicUrl(filePath);
        return data.publicUrl;
    }

    async function signInWithGitHub() {
        setAuthError("");
        setIsAuthActionLoading(true);

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
                if (!canManageItems) return;

                if (ignoreNextMapClickRef.current) {
                    ignoreNextMapClickRef.current = false;
                    return;
                }

                if (isSavingItem) return;

                setPendingItemType(null);
                setPendingEstimatedWeight("");
                setPendingLocation({
                    y: e.latlng.lat,
                    x: e.latlng.lng,
                });
            },
        });
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

            map.flyTo(
                [liveLocation.latitude, liveLocation.longitude],
                Math.max(map.getZoom(), 16),
                { duration: 0.8 },
            );
            hasCenteredRef.current = true;
        }, [map, liveLocation]);

        return null;
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
        setUploadProgressText(imageSource === "camera" ? "Opening camera..." : "Opening gallery...");
        setIsPickingImage(true);

        const resetPickerState = () => {
            setIsPickingImage(false);
        };

        const handleWindowFocus = () => {
            window.setTimeout(() => {
                resetPickerState();
            }, 250);
        };

        window.addEventListener("focus", handleWindowFocus, { once: true });

        input.onchange = async (event) => {
            const file = event.target.files?.[0];
            const estimatedWeightKg = parseEstimatedWeightKg(pendingEstimatedWeight) || getDefaultWeightForType(selectedType);
            let saveSucceeded = false;
            resetPickerState();

            if (!file) {
                setUploadProgressText("No image selected.");
                window.setTimeout(() => setUploadProgressText(""), 1500);
                return;
            }

            setIsSavingItem(true);
            setUploadProgressText("Reading photo details...");

            try {
                const imageGps = await extractGpsFromImage(file);
                setUploadProgressText("Uploading photo...");
                const imageUrl = await uploadImage(file);
                let gpsSavedToDb = false;
                let weightSavedToDb = false;
                // Use EXIF GPS if available, otherwise fall back to the map-click location
                const gpsSource = imageGps || { latitude: point.y, longitude: point.x };

                const insertPayload = {
                    y: point.y,
                    x: point.x,
                    type: selectedType,
                    image_url: imageUrl,
                    is_recovered: false,
                };

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

                if (gpsColumnMissing || weightColumnMissing) {
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
                await fetchItems();
                saveSucceeded = true;
                setUploadProgressText("");
            } catch {
                setUploadProgressText("Upload failed. Please try again.");
                alert("Upload failed. Please try again.");
            } finally {
                setIsSavingItem(false);
                resetPickerState();

                if (saveSucceeded) {
                    setPendingItemType(null);
                    setPendingLocation(null);
                    setPendingEstimatedWeight("");
                    setPendingCount(1);
                }
            }
        };

        input.oncancel = () => {
            resetPickerState();
            setUploadProgressText("No image selected.");
            window.setTimeout(() => setUploadProgressText(""), 1500);
        };

        input.click();
    }

    function startEditingItem(item) {
        if (!canManageItems) {
            alert("This account is read-only for now.");
            return;
        }

        const counts = getItemCounts(item);

        const gps = getItemGps(item);
        const estimatedWeight = getItemEstimatedWeight(item);
        setEditingItemId(item.id);
        setEditForm({
            type: normalizeType(item.type),
            total: counts.total,
            recovered: counts.recovered,
            estimatedWeight: String(estimatedWeight.value),
            lat: gps ? String(gps.latitude) : "",
            lng: gps ? String(gps.longitude) : "",
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

        const updatePayload = {
            type: nextType,
            is_recovered: nextRecoveredState,
        };

        if (dbCountFieldSupport.total) updatePayload.total_count = total;
        if (dbCountFieldSupport.recovered) updatePayload.recovered_count = recovered;
        if (dbWeightFieldSupport !== false) updatePayload.estimated_weight_kg = estimatedWeightKg;

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

        if (gpsColumnMissing || weightColumnMissing) {
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

            const retryResult = await supabase
                .from("items")
                .update(retryPayload)
                .eq("id", itemId);

            error = retryResult.error;
        }

        if (error) {
            alert("Unable to save changes.");
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

        setEditingItemId(null);
        setIsUpdatingItemId(null);
        fetchItems();
    }

    async function removeLocation(itemId) {
        if (!canManageItems) {
            alert("This account is read-only for now.");
            return;
        }

        const confirmed = window.confirm("Remove this location and all its item data?");
        if (!confirmed) return;

        setIsUpdatingItemId(itemId);

        const { error } = await supabase.from("items").delete().eq("id", itemId);

        if (error) {
            alert("Could not delete this location.");
            setIsUpdatingItemId(null);
            return;
        }

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

        if (editingItemId === itemId) {
            setEditingItemId(null);
        }

        if (selectedItemId === itemId) {
            setSelectedItemId(null);
            setIsImageViewerOpen(false);
        }

        setIsUpdatingItemId(null);
        fetchItems();
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
            totalByType: { trolley: 0, bike: 0, motorbike: 0, misc: 0 },
            estimatedRecoveredKg: 0,
            estimatedRemainingKg: 0,
            recoveredByType: { trolley: 0, bike: 0, motorbike: 0, misc: 0 },
            remainingByType: { trolley: 0, bike: 0, motorbike: 0, misc: 0 },
            totalWeightByType: { trolley: 0, bike: 0, motorbike: 0, misc: 0 },
            recoveredWeightByType: { trolley: 0, bike: 0, motorbike: 0, misc: 0 },
            remainingWeightByType: { trolley: 0, bike: 0, motorbike: 0, misc: 0 },
        },
    );

        return baseStats;
    }, [filteredItems, localCounts, dbCountFieldSupport, localWeights, dbWeightFieldSupport]);

    const tideChartData = useMemo(
        () => buildTideChartData(lancasterTideRows, lancasterTideUpdatedAt),
        [lancasterTideRows, lancasterTideUpdatedAt],
    );

    const mapHeight = isTidePlannerCollapsed
        ? isMobile
            ? "calc(100dvh - 198px)"
            : "calc(100dvh - 242px)"
        : isMobile
          ? "calc(100svh - 150px)"
          : "calc(100vh - 250px)";
    const controlFontSize = isMobile ? "0.95rem" : "0.85rem";
    const touchButtonSize = isMobile ? "38px" : "30px";
    const activeFilterCount = Number(typeFilter !== "all") + Number(statusFilter !== "all");
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
                background: "linear-gradient(180deg, rgba(255,255,255,0.88) 0%, rgba(248,250,252,0.9) 100%)",
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
            <AppTopBar
                isMobile={isMobile}
                authReady={authReady}
                currentUser={currentUser}
                canManageItems={canManageItems}
                isAuthActionLoading={isAuthActionLoading}
                onSignIn={signInWithGitHub}
                onSignOut={signOut}
                isLoadingItems={isLoadingItems}
            />

            {isMobile && authError ? (
                <div
                    style={{
                        marginBottom: "8px",
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

            <SummaryStats
                totals={totals}
                locationCount={filteredItems.length}
                controlFontSize={controlFontSize}
                isMobile={isMobile}
                impactStats={impactStats}
            />

            <ControlToggles
                isMobile={isMobile}
                isTidePlannerCollapsed={isTidePlannerCollapsed}
                onToggleTidePlanner={() => setIsTidePlannerCollapsed((prev) => !prev)}
            />

            <TidePlanner
                isTidePlannerCollapsed={isTidePlannerCollapsed}
                isMobile={isMobile}
                isLoadingLancasterTides={isLoadingLancasterTides}
                fetchLancasterTides={fetchLancasterTides}
                lancasterTideUpdatedAt={lancasterTideUpdatedAt}
                lancasterTideError={lancasterTideError}
                tideChartData={tideChartData}
            />

            <MapStatusBanner
                isLoadingItems={isLoadingItems}
                totalItemCount={items.length}
                filteredItemCount={filteredItems.length}
                isMobile={isMobile}
            />

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
                    <MapEvents />
                    <LiveLocationAutoCenter />

                    {isLiveLocationEnabled && liveLocation && (
                        <CircleMarker
                            center={[liveLocation.latitude, liveLocation.longitude]}
                            radius={8}
                            pathOptions={{
                                color: "#0284c7",
                                fillColor: "#38bdf8",
                                fillOpacity: 0.75,
                                weight: 2,
                            }}
                        />
                    )}

                    {pendingLocation && (
                        <Marker
                            position={[pendingLocation.y, pendingLocation.x]}
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
                    />

                    {filteredItems.map((item) => {
                        const gps = getItemGps(item);
                        if (!gps) return null;
                        return (
                            <Marker
                                key={item.id}
                                position={[gps.latitude, gps.longitude]}
                                icon={getIcon(item.type, getItemCounts(item).isRecovered)}
                                eventHandlers={{
                                    click: () => {
                                        setSelectedItemId(item.id);
                                        setEditingItemId(null);
                                    },
                                }}
                            />
                        );
                    })}
                </MapContainer>

                {isMobile ? (
                    <button
                        type="button"
                        onClick={() => {
                            setIsFilterSheetOpen(true);
                            setIsMapToolsOpen(false);
                        }}
                        style={{
                            position: "absolute",
                            top: "10px",
                            right: "10px",
                            zIndex: 900,
                            border: "1px solid #cbd5e1",
                            background: "rgba(255,255,255,0.96)",
                            color: "#0f172a",
                            borderRadius: "999px",
                            padding: "7px 11px",
                            fontSize: "0.78rem",
                            fontWeight: 700,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "7px",
                            boxShadow: "0 6px 18px rgba(15,23,42,0.14)",
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
                        setTypeFilter={setTypeFilter}
                        setStatusFilter={setStatusFilter}
                        isOverlay
                    />
                )}

                <div
                    style={{
                        position: "absolute",
                        bottom: isMobile ? "28px" : "22px",
                        right: "10px",
                        zIndex: 900,
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px",
                        alignItems: "flex-end",
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
                        <span>Map Tools</span>
                        <span style={{ fontSize: "0.9em" }}>{isMapToolsOpen ? "▾" : "▴"}</span>
                    </button>

                    <SurfaceCard
                        style={{
                            width: isMobile ? "min(88vw, 300px)" : "280px",
                            padding: "10px",
                            display: "grid",
                            gap: "8px",
                            opacity: isMapToolsOpen ? 1 : 0,
                            transform: isMapToolsOpen ? "translateY(0) scale(1)" : "translateY(8px) scale(0.98)",
                            transformOrigin: "bottom right",
                            transition: "opacity 180ms ease, transform 220ms ease",
                            pointerEvents: isMapToolsOpen ? "auto" : "none",
                        }}
                    >
                            <button
                                type="button"
                                onClick={() => setIsLiveLocationEnabled((prev) => !prev)}
                                style={{
                                    border: "1px solid #cbd5e1",
                                    background: isLiveLocationEnabled ? "#e0f2fe" : "#fff",
                                    color: "#0f172a",
                                    borderRadius: "9px",
                                    minHeight: "36px",
                                    padding: "0 10px",
                                    fontWeight: 700,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                }}
                            >
                                <span>Live Location</span>
                                <span style={{ color: isLiveLocationEnabled ? "#0284c7" : "#64748b" }}>
                                    {isLiveLocationEnabled ? "On" : "Off"}
                                </span>
                            </button>

                            {waybackReleases.length > 0 ? (
                                <label style={{ display: "grid", gap: "5px", fontSize: "0.75rem", color: "#475569", fontWeight: 700 }}>
                                    <span>Imagery</span>
                                    <select
                                        value={selectedWaybackId ?? ""}
                                        onChange={(e) => setSelectedWaybackId(e.target.value ? Number(e.target.value) : null)}
                                        style={{
                                            border: "1px solid #cbd5e1",
                                            borderRadius: "8px",
                                            padding: "7px 8px",
                                            background: "#fff",
                                            fontSize: "0.82rem",
                                        }}
                                    >
                                        <option value="">Mapbox (Live)</option>
                                        {waybackReleases.map((r) => (
                                            <option key={r.releaseNum} value={r.releaseNum}>
                                                {r.releaseName}
                                            </option>
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
                            padding: "12px 12px calc(env(safe-area-inset-bottom, 0px) + 14px)",
                            transform: "translateY(0)",
                            transition: "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
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
                            <strong style={{ color: "#0f172a", fontSize: "0.92rem" }}>Filters</strong>
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
                            setTypeFilter={setTypeFilter}
                            setStatusFilter={setStatusFilter}
                        />
                    </SurfaceCard>
                </>
            ) : null}

            <SelectedItemDrawer
                selectedItem={selectedItem}
                selectedCounts={selectedCounts}
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
                onCopyShareLink={copyShareLinkForItem}
                copiedShareItemId={copiedShareItemId}
                shareCopyStatus={shareCopyStatus}
            />

            <FullscreenImageViewer
                isOpen={isImageViewerOpen}
                isMobile={isMobile}
                selectedItem={selectedItem}
                selectedCounts={selectedCounts}
                selectedGps={selectedGps}
                selectedGeoLookup={selectedGeoLookup}
                isResolvingGeoLookup={isResolvingGeoLookup}
                selectedMapsUrl={selectedMapsUrl}
                onClose={() => setIsImageViewerOpen(false)}
            />
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
