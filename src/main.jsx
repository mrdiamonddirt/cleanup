import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import {
    MapContainer,
    ImageOverlay,
    Marker,
    Popup,
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

const bounds = [
    [0, 0],
    [830, 1687],
];

const TYPE_LABELS = {
    bike: "Bike",
    trolley: "Trolley",
    misc: "Misc",
};

const COUNT_STORAGE_KEY = "cleanup-item-counts-v1";
const GPS_STORAGE_KEY = "cleanup-item-gps-v1";
const LANCASTER_TIDE_JSON_URL = `${import.meta.env.BASE_URL}lancaster-tides.json`;
const LANCASTER_TIDE_CHART_URL =
    "https://www.tide-forecast.com/tide/Lancaster/tide-times";

const createMapsUrl = (lat, lng) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;

const parseGpsNumber = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return parsed;
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

    const width = 760;
    const height = 280;
    const padding = { top: 26, right: 18, bottom: 58, left: 18 };
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

    const now = new Date();
    let currentMarker = null;

    if (now.getTime() >= minTime && now.getTime() <= maxTime) {
        for (let index = 0; index < parsedRows.length - 1; index += 1) {
            const start = parsedRows[index];
            const end = parsedRows[index + 1];
            const startTime = start.date.getTime();
            const endTime = end.date.getTime();

            if (now.getTime() < startTime || now.getTime() > endTime) continue;

            const segmentProgress = (now.getTime() - startTime) / (endTime - startTime || 1);
            const easedProgress = (1 - Math.cos(Math.PI * segmentProgress)) / 2;
            const currentHeight = start.height + (end.height - start.height) * easedProgress;

            currentMarker = {
                time: now,
                height: currentHeight,
                x: getX(now.getTime()),
                y: getY(currentHeight),
                previous: start,
                next: end,
            };
            break;
        }
    }

    const nextTide = parsedRows.find((row) => row.date.getTime() >= now.getTime()) || null;
    const previousTide = [...parsedRows].reverse().find((row) => row.date.getTime() <= now.getTime()) || null;

    return {
        width,
        height,
        padding,
        baselineY: padding.top + chartHeight,
        medianY: getY(medianHeight),
        points,
        curvePath,
        areaPath,
        currentMarker,
        nextTide,
        previousTide,
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
        trolley: "🛒",
        misc: "🧰",
    };

    const colors = {
        bike: "#3498db",
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

const pendingPlacementIcon = L.divIcon({
    className: "pending-placement-marker",
    html: `
        <div style="position: relative; width: 34px; height: 34px; border-radius: 50%; background: #2563eb; color: #fff; border: 3px solid #ffffff; box-shadow: 0 3px 10px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; font-size: 16px; font-weight: 700;">
            +
            <span style="position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%); width: 10px; height: 10px; background: #2563eb; border-right: 2px solid #fff; border-bottom: 2px solid #fff; transform-origin: center; rotate: 45deg;"></span>
        </div>
    `,
    iconSize: [34, 40],
    iconAnchor: [17, 36],
});

function App() {
    const [items, setItems] = useState([]);
    const [typeFilter, setTypeFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [pendingLocation, setPendingLocation] = useState(null);
    const [pendingItemType, setPendingItemType] = useState(null);
    const [isSavingItem, setIsSavingItem] = useState(false);
    const [pendingCount, setPendingCount] = useState(1);
    const [editingItemId, setEditingItemId] = useState(null);
    const [editForm, setEditForm] = useState({ type: "misc", total: 1, recovered: 0 });
    const [isUpdatingItemId, setIsUpdatingItemId] = useState(null);
    const [selectedItemId, setSelectedItemId] = useState(null);
    const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
    const [areControlsCollapsed, setAreControlsCollapsed] = useState(() =>
        typeof window !== "undefined" ? window.innerWidth <= 768 : false,
    );
    const [isTidePlannerCollapsed, setIsTidePlannerCollapsed] = useState(() =>
        typeof window !== "undefined" ? window.innerWidth <= 768 : false,
    );
    const [lancasterTideRows, setLancasterTideRows] = useState([]);
    const [isLoadingLancasterTides, setIsLoadingLancasterTides] = useState(false);
    const [lancasterTideError, setLancasterTideError] = useState("");
    const [lancasterTideUpdatedAt, setLancasterTideUpdatedAt] = useState("");
    const [localCounts, setLocalCounts] = useState({});
    const [localGps, setLocalGps] = useState({});
    const [dbCountFieldSupport, setDbCountFieldSupport] = useState({
        total: false,
        recovered: false,
    });
    const [dbGpsFieldSupport, setDbGpsFieldSupport] = useState({
        latitude: null,
        longitude: null,
    });
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== "undefined" ? window.innerWidth <= 768 : false,
    );

    useEffect(() => {
        const stored = localStorage.getItem(COUNT_STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (parsed && typeof parsed === "object") {
                    setLocalCounts(parsed);
                }
            } catch {
                // ignore corrupted local storage and continue
            }
        }

        const storedGps = localStorage.getItem(GPS_STORAGE_KEY);
        if (storedGps) {
            try {
                const parsedGps = JSON.parse(storedGps);
                if (parsedGps && typeof parsedGps === "object") {
                    setLocalGps(parsedGps);
                }
            } catch {
                // ignore corrupted local storage and continue
            }
        }

        fetchItems();
    }, []);

    useEffect(() => {
        localStorage.setItem(COUNT_STORAGE_KEY, JSON.stringify(localCounts));
    }, [localCounts]);

    useEffect(() => {
        localStorage.setItem(GPS_STORAGE_KEY, JSON.stringify(localGps));
    }, [localGps]);

    useEffect(() => {
        const handleResize = () => {
            setIsMobile(window.innerWidth <= 768);
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

    async function fetchItems() {
        const { data, error } = await supabase.from("items").select("*");

        if (error) return;

        const first = data?.[0] || {};
        setDbCountFieldSupport({
            total: Object.prototype.hasOwnProperty.call(first, "total_count"),
            recovered: Object.prototype.hasOwnProperty.call(first, "recovered_count"),
        });
        if (data && data.length > 0) {
            setDbGpsFieldSupport({
                latitude: Object.prototype.hasOwnProperty.call(first, "gps_latitude"),
                longitude: Object.prototype.hasOwnProperty.call(first, "gps_longitude"),
            });
        }
        setItems(data || []);
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

    // Click handler to add new items to SQL
    function MapEvents() {
        useMapEvents({
            click: async (e) => {
                if (isSavingItem) return;

                setPendingItemType(null);
                setPendingLocation({
                    y: e.latlng.lat,
                    x: e.latlng.lng,
                });
            },
        });
        return null;
    }

    async function handleTypePick(selectedType, imageSource = "gallery") {
        if (!pendingLocation || isSavingItem) return;

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        if (imageSource === "camera") {
            input.capture = "environment";
        }

        const point = pendingLocation;

        input.onchange = async (event) => {
            const file = event.target.files?.[0];

            if (!file) {
                return;
            }

            setIsSavingItem(true);

            try {
                const imageGps = await extractGpsFromImage(file);
                const imageUrl = await uploadImage(file);
                let gpsSavedToDb = false;

                const insertPayload = {
                    y: point.y,
                    x: point.x,
                    type: selectedType,
                    image_url: imageUrl,
                    is_recovered: false,
                };

                if (dbCountFieldSupport.total) insertPayload.total_count = pendingCount;
                if (dbCountFieldSupport.recovered) insertPayload.recovered_count = 0;
                if (
                    imageGps &&
                    dbGpsFieldSupport.latitude !== false &&
                    dbGpsFieldSupport.longitude !== false
                ) {
                    insertPayload.gps_latitude = imageGps.latitude;
                    insertPayload.gps_longitude = imageGps.longitude;
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

                if (gpsColumnMissing) {
                    const retryPayload = { ...insertPayload };
                    delete retryPayload.gps_latitude;
                    delete retryPayload.gps_longitude;

                    setDbGpsFieldSupport({ latitude: false, longitude: false });

                    const retryResult = await supabase
                        .from("items")
                        .insert([retryPayload])
                        .select("id")
                        .single();

                    data = retryResult.data;
                    error = retryResult.error;
                } else if (imageGps && !error) {
                    gpsSavedToDb = true;
                    setDbGpsFieldSupport((prev) => ({
                        latitude: prev.latitude ?? true,
                        longitude: prev.longitude ?? true,
                    }));
                }

                if (error) {
                    alert("Could not save item. Please try again.");
                    return;
                }

                if (!dbCountFieldSupport.total && data?.id) {
                    setLocalCounts((prev) => ({
                        ...prev,
                        [data.id]: { total: pendingCount, recovered: 0 },
                    }));
                }

                if (imageGps && data?.id && !gpsSavedToDb) {
                    setLocalGps((prev) => ({
                        ...prev,
                        [data.id]: {
                            latitude: imageGps.latitude,
                            longitude: imageGps.longitude,
                        },
                    }));
                }

                fetchItems();
            } catch {
                alert("Upload failed. Please try again.");
            } finally {
                setIsSavingItem(false);
                setPendingItemType(null);
                setPendingLocation(null);
                setPendingCount(1);
            }
        };

        input.click();
    }

    function startEditingItem(item) {
        const counts = getItemCounts(item);

        setEditingItemId(item.id);
        setEditForm({
            type: normalizeType(item.type),
            total: counts.total,
            recovered: counts.recovered,
        });
    }

    async function saveItemEdits(itemId) {
        const total = Math.max(1, clampInt(editForm.total, 1));
        const recovered = Math.min(total, clampInt(editForm.recovered, 0));
        const nextType = normalizeType(editForm.type);
        const nextRecoveredState = recovered >= total;

        const updatePayload = {
            type: nextType,
            is_recovered: nextRecoveredState,
        };

        if (dbCountFieldSupport.total) updatePayload.total_count = total;
        if (dbCountFieldSupport.recovered) updatePayload.recovered_count = recovered;

        setIsUpdatingItemId(itemId);

        const { error } = await supabase
            .from("items")
            .update(updatePayload)
            .eq("id", itemId);

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

        setEditingItemId(null);
        setIsUpdatingItemId(null);
        fetchItems();
    }

    async function removeLocation(itemId) {
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

    const filteredItems = items.filter((item) => {
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
    });

    const totals = filteredItems.reduce(
        (acc, item) => {
            const counts = getItemCounts(item);
            acc.total += counts.total;
            acc.recovered += counts.recovered;
            acc.remaining += counts.inWater;
            return acc;
        },
        { total: 0, recovered: 0, remaining: 0 },
    );

    const tideChartData = buildTideChartData(lancasterTideRows, lancasterTideUpdatedAt);

    const mapHeight = isMobile ? "58svh" : "calc(100vh - 250px)";
    const controlFontSize = isMobile ? "0.95rem" : "0.85rem";
    const touchButtonSize = isMobile ? "38px" : "30px";
    const selectedItem = selectedItemId
        ? items.find((item) => item.id === selectedItemId) || null
        : null;
    const selectedCounts = selectedItem ? getItemCounts(selectedItem) : null;
    const selectedGps = selectedItem ? getItemGps(selectedItem) : null;
    const selectedMapsUrl = selectedGps
        ? createMapsUrl(selectedGps.latitude, selectedGps.longitude)
        : null;

    return (
        <div
            style={{
                padding: isMobile ? "10px 8px 14px" : "10px",
                fontFamily: "sans-serif",
                maxWidth: "1200px",
                margin: "0 auto",
            }}
        >
            <h1 style={{ fontSize: "1.5rem", marginBottom: "5px" }}>
                🌊 River Cleanup
            </h1>
            <p style={{ fontSize: "0.9rem", color: "#555" }}>
                Tap map to log. Tap marker for details.
            </p>

            {pendingLocation && (
                <div
                    style={{
                        marginTop: "12px",
                        marginBottom: "12px",
                        padding: "12px",
                        border: "1px solid #cbd5e1",
                        borderRadius: "10px",
                        background: "#f8fafc",
                    }}
                >
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
                            disabled={isSavingItem}
                            style={{
                                border: "1px solid #94a3b8",
                                background: "#fff",
                                borderRadius: "6px",
                                width: touchButtonSize,
                                height: touchButtonSize,
                                fontWeight: 700,
                                cursor: isSavingItem ? "not-allowed" : "pointer",
                            }}
                        >
                            -
                        </button>
                        <strong style={{ minWidth: "24px", textAlign: "center" }}>
                            {pendingCount}
                        </strong>
                        <button
                            onClick={() => setPendingCount((prev) => prev + 1)}
                            disabled={isSavingItem}
                            style={{
                                border: "1px solid #94a3b8",
                                background: "#fff",
                                borderRadius: "6px",
                                width: touchButtonSize,
                                height: touchButtonSize,
                                fontWeight: 700,
                                cursor: isSavingItem ? "not-allowed" : "pointer",
                            }}
                        >
                            +
                        </button>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {pendingItemType ? (
                            <>
                                <button
                                    onClick={() => handleTypePick(pendingItemType, "camera")}
                                    disabled={isSavingItem}
                                    style={{
                                        border: "1px solid #2563eb",
                                        background: "#eff6ff",
                                        color: "#1d4ed8",
                                        padding: isMobile ? "10px 14px" : "8px 12px",
                                        borderRadius: "8px",
                                        fontSize: controlFontSize,
                                        fontWeight: 700,
                                        cursor: isSavingItem ? "not-allowed" : "pointer",
                                        opacity: isSavingItem ? 0.6 : 1,
                                    }}
                                >
                                    Use Camera
                                </button>
                                <button
                                    onClick={() => handleTypePick(pendingItemType, "gallery")}
                                    disabled={isSavingItem}
                                    style={{
                                        border: "1px solid #94a3b8",
                                        background: "#fff",
                                        color: "#0f172a",
                                        padding: isMobile ? "10px 14px" : "8px 12px",
                                        borderRadius: "8px",
                                        fontSize: controlFontSize,
                                        fontWeight: 700,
                                        cursor: isSavingItem ? "not-allowed" : "pointer",
                                        opacity: isSavingItem ? 0.6 : 1,
                                    }}
                                >
                                    Choose From Gallery
                                </button>
                                <button
                                    onClick={() => setPendingItemType(null)}
                                    disabled={isSavingItem}
                                    style={{
                                        border: "1px solid #cbd5e1",
                                        background: "transparent",
                                        color: "#475569",
                                        padding: isMobile ? "10px 14px" : "8px 12px",
                                        borderRadius: "8px",
                                        fontSize: controlFontSize,
                                        fontWeight: 600,
                                        cursor: isSavingItem ? "not-allowed" : "pointer",
                                        opacity: isSavingItem ? 0.6 : 1,
                                    }}
                                >
                                    Back
                                </button>
                            </>
                        ) : (
                            <>
                                {[
                                    { key: "bike", label: "🚲 Bike" },
                                    { key: "trolley", label: "🛒 Trolley" },
                                    { key: "misc", label: "🧰 Misc" },
                                ].map((option) => (
                                    <button
                                        key={option.key}
                                        onClick={() => setPendingItemType(option.key)}
                                        disabled={isSavingItem}
                                        style={{
                                            border: "1px solid #94a3b8",
                                            background: "#fff",
                                            color: "#0f172a",
                                            padding: isMobile ? "10px 14px" : "8px 12px",
                                            borderRadius: "8px",
                                            fontSize: controlFontSize,
                                            fontWeight: 700,
                                            cursor: isSavingItem ? "not-allowed" : "pointer",
                                            opacity: isSavingItem ? 0.6 : 1,
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
                                setPendingLocation(null);
                            }}
                            disabled={isSavingItem}
                            style={{
                                border: "1px solid #cbd5e1",
                                background: "transparent",
                                color: "#475569",
                                padding: isMobile ? "10px 14px" : "8px 12px",
                                borderRadius: "8px",
                                fontSize: controlFontSize,
                                fontWeight: 600,
                                cursor: isSavingItem ? "not-allowed" : "pointer",
                                opacity: isSavingItem ? 0.6 : 1,
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                    {isSavingItem && (
                        <div
                            style={{
                                marginTop: "8px",
                                fontSize: "0.8rem",
                                color: "#64748b",
                            }}
                        >
                            Uploading and saving item...
                        </div>
                    )}
                </div>
            )}

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "10px",
                    flexWrap: "wrap",
                    marginTop: "10px",
                    marginBottom: "10px",
                }}
            >
                <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "#0f172a" }}>
                    Filters & Stats
                </div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        flexWrap: "wrap",
                        justifyContent: isMobile ? "flex-start" : "flex-end",
                    }}
                >
                    <button
                        onClick={() => setAreControlsCollapsed((prev) => !prev)}
                        style={{
                            border: "1px solid #cbd5e1",
                            background: "linear-gradient(135deg, #ffffff, #f8fafc)",
                            color: "#0f172a",
                            borderRadius: "999px",
                            padding: isMobile ? "8px 12px" : "6px 12px",
                            minHeight: "32px",
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
                        aria-expanded={!areControlsCollapsed}
                        aria-label={areControlsCollapsed ? "Show filters and stats" : "Hide filters and stats"}
                    >
                        <span>{areControlsCollapsed ? "Show Controls" : "Hide Controls"}</span>
                        <span style={{ fontSize: "0.9em" }}>{areControlsCollapsed ? "▾" : "▴"}</span>
                    </button>
                    <button
                        onClick={() => setIsTidePlannerCollapsed((prev) => !prev)}
                        style={{
                            border: "1px solid #cbd5e1",
                            background: "linear-gradient(135deg, #eff6ff, #f8fafc)",
                            color: "#0f172a",
                            borderRadius: "999px",
                            padding: isMobile ? "8px 12px" : "6px 12px",
                            minHeight: "32px",
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

            <div
                style={{
                    maxHeight: areControlsCollapsed ? "0px" : "1400px",
                    opacity: areControlsCollapsed ? 0 : 1,
                    transform: areControlsCollapsed ? "translateY(-4px)" : "translateY(0)",
                    overflow: areControlsCollapsed ? "hidden" : "visible",
                    pointerEvents: areControlsCollapsed ? "none" : "auto",
                    transition:
                        "max-height 260ms ease, opacity 180ms ease, transform 220ms ease",
                }}
            >
            <div
                style={{
                    display: "flex",
                    flexWrap: isMobile ? "nowrap" : "wrap",
                    flexDirection: isMobile ? "column" : "row",
                    gap: "10px",
                    marginBottom: "12px",
                    marginTop: "10px",
                    alignItems: isMobile ? "stretch" : "center",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: controlFontSize, fontWeight: 600 }}>Type:</span>
                    <select
                        value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)}
                        style={{
                            border: "1px solid #cbd5e1",
                            borderRadius: "8px",
                            padding: isMobile ? "10px 10px" : "6px 8px",
                            fontSize: controlFontSize,
                            background: "#fff",
                            minHeight: isMobile ? "42px" : "34px",
                            width: isMobile ? "100%" : "auto",
                        }}
                    >
                        <option value="all">All</option>
                        <option value="bike">Bikes</option>
                        <option value="trolley">Trolleys</option>
                        <option value="misc">Misc</option>
                    </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontSize: controlFontSize, fontWeight: 600 }}>Status:</span>
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        style={{
                            border: "1px solid #cbd5e1",
                            borderRadius: "8px",
                            padding: isMobile ? "10px 10px" : "6px 8px",
                            fontSize: controlFontSize,
                            background: "#fff",
                            minHeight: isMobile ? "42px" : "34px",
                            width: isMobile ? "100%" : "auto",
                        }}
                    >
                        <option value="all">All</option>
                        <option value="in-water">In Water</option>
                        <option value="recovered">Recovered</option>
                    </select>
                </div>
            </div>

            {/* Responsive Stats Box */}
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap", // Allows boxes to stack on small screens
                    gap: "10px",
                    marginBottom: "15px",
                    padding: isMobile ? "12px" : "10px",
                    background: "#f8f9fa",
                    borderRadius: "8px",
                    border: "1px solid #ddd",
                    fontSize: controlFontSize,
                }}
            >
                <div style={{ flex: "1 1 100px" }}>
                    Total Items: <strong>{totals.total}</strong>
                </div>
                <div style={{ flex: "1 1 100px" }}>
                    Recovered:{" "}
                    <strong style={{ color: "green" }}>
                        {totals.recovered}
                    </strong>
                </div>
                <div style={{ flex: "1 1 100px" }}>
                    Remaining:{" "}
                    <strong style={{ color: "red" }}>
                        {totals.remaining}
                    </strong>
                </div>
                <div style={{ flex: "1 1 100px" }}>
                    Locations:{" "}
                    <strong style={{ color: "#2c3e50" }}>
                        {filteredItems.length}
                    </strong>
                </div>
            </div>

            <div
                style={{
                    marginBottom: "14px",
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
                            padding: isMobile ? "12px" : "12px 14px",
                            border: "1px solid #cbd5e1",
                            borderRadius: "10px",
                            background: "linear-gradient(140deg, #eff6ff, #f8fafc)",
                        }}
                    >
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: "8px",
                                    flexWrap: "wrap",
                                    marginBottom: "8px",
                                }}
                            >
                                <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "#1e293b" }}>
                                    Lancaster, UK
                                </div>
                                <button
                                    onClick={fetchLancasterTides}
                                    disabled={isLoadingLancasterTides}
                                    style={{
                                        border: "1px solid #94a3b8",
                                        borderRadius: "999px",
                                        padding: "6px 12px",
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

                        <div style={{ fontSize: "0.84rem", color: "#334155", marginBottom: "8px" }}>
                            Best cleanup window is usually around low tide: target about 90 minutes before and after the low tide dips shown on the graph.
                        </div>

                            {lancasterTideUpdatedAt ? (
                                <div style={{ fontSize: "0.78rem", color: "#64748b", marginBottom: "8px" }}>
                                    Updated: {new Date(lancasterTideUpdatedAt).toLocaleString()}
                                </div>
                            ) : null}

                        {lancasterTideError ? (
                            <div
                                style={{
                                    marginBottom: "8px",
                                    padding: "10px",
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

                        {tideChartData ? (
                            <div
                                style={{
                                    border: "1px solid #dbeafe",
                                    borderRadius: "10px",
                                    background: "#ffffff",
                                    marginBottom: "10px",
                                    padding: isMobile ? "12px" : "14px",
                                }}
                            >
                                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                                    <div
                                        style={{
                                            display: "flex",
                                            gap: "10px",
                                            flexWrap: "wrap",
                                            fontSize: "0.79rem",
                                            color: "#475569",
                                        }}
                                    >
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                            <span
                                                aria-hidden="true"
                                                style={{ width: "10px", height: "10px", borderRadius: "999px", background: "#1d4ed8" }}
                                            />
                                            Tide curve
                                        </span>
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                            <span
                                                aria-hidden="true"
                                                style={{ width: "10px", height: "10px", borderRadius: "999px", background: "#16a34a" }}
                                            />
                                            Low tide window
                                        </span>
                                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                                            <span
                                                aria-hidden="true"
                                                style={{ width: "2px", height: "14px", background: "#dc2626" }}
                                            />
                                            Current time
                                        </span>
                                    </div>

                                    <div style={{ width: "100%", overflowX: "auto" }}>
                                        <svg
                                            viewBox={`0 0 ${tideChartData.width} ${tideChartData.height}`}
                                            role="img"
                                            aria-label="Wave graph of upcoming Lancaster tide highs, lows, and current time"
                                            style={{ width: "100%", minWidth: isMobile ? "620px" : "100%", height: "auto", display: "block" }}
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

                                            {tideChartData.currentMarker ? (
                                                <g>
                                                    <line
                                                        x1={tideChartData.currentMarker.x}
                                                        x2={tideChartData.currentMarker.x}
                                                        y1={tideChartData.padding.top}
                                                        y2={tideChartData.baselineY}
                                                        stroke="#dc2626"
                                                        strokeWidth="2"
                                                        strokeDasharray="6 4"
                                                    />
                                                    <circle
                                                        cx={tideChartData.currentMarker.x}
                                                        cy={tideChartData.currentMarker.y}
                                                        r="5"
                                                        fill="#dc2626"
                                                        stroke="#ffffff"
                                                        strokeWidth="2.5"
                                                    />
                                                </g>
                                            ) : null}

                                            {tideChartData.points.map((point) => {
                                                const timeY = point.isLowTide ? point.y + 22 : point.y - 12;

                                                return (
                                                    <g key={`point-${point.index}`}>
                                                        <circle
                                                            cx={point.x}
                                                            cy={point.y}
                                                            r="8"
                                                            fill={point.isLowTide ? "#16a34a" : "#2563eb"}
                                                            opacity="0.16"
                                                        />
                                                        <circle
                                                            cx={point.x}
                                                            cy={point.y}
                                                            r="4.5"
                                                            fill={point.isLowTide ? "#16a34a" : "#1d4ed8"}
                                                            stroke="#ffffff"
                                                            strokeWidth="2.5"
                                                        />
                                                        <text
                                                            x={point.x}
                                                            y={timeY}
                                                            textAnchor="middle"
                                                            fontSize="9.5"
                                                            fill="#64748b"
                                                        >
                                                            {formatTideTime(point.date).replace(/^[A-Za-z]{3},?\s*/, "")}
                                                        </text>
                                                        <text
                                                            x={point.x}
                                                            y={tideChartData.height - 18}
                                                            textAnchor="middle"
                                                            fontSize="10"
                                                            fill="#64748b"
                                                        >
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
                                            gap: "8px",
                                        }}
                                    >
                                        <div
                                            style={{
                                                borderRadius: "10px",
                                                border: "1px solid #dbeafe",
                                                background: "#eff6ff",
                                                padding: "10px 12px",
                                            }}
                                        >
                                            <div style={{ fontSize: "0.73rem", fontWeight: 700, color: "#1d4ed8", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                                Previous tide
                                            </div>
                                            <div style={{ marginTop: "4px", fontSize: "0.9rem", fontWeight: 700, color: "#0f172a" }}>
                                                {tideChartData.previousTide ? tideChartData.previousTide.type : "Unavailable"}
                                            </div>
                                            <div style={{ marginTop: "2px", fontSize: "0.8rem", color: "#475569" }}>
                                                {tideChartData.previousTide ? `${formatTideTime(tideChartData.previousTide.date)} • ${tideChartData.previousTide.height.toFixed(2)} m` : "No tide before current time in this range."}
                                            </div>
                                        </div>

                                        <div
                                            style={{
                                                borderRadius: "10px",
                                                border: "1px solid #fecaca",
                                                background: "#fef2f2",
                                                padding: "10px 12px",
                                            }}
                                        >
                                            <div style={{ fontSize: "0.73rem", fontWeight: 700, color: "#b91c1c", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                                Current time
                                            </div>
                                            <div style={{ marginTop: "4px", fontSize: "0.9rem", fontWeight: 700, color: "#0f172a" }}>
                                                {formatTideTime(tideChartData.currentMarker?.time || new Date())}
                                            </div>
                                            <div style={{ marginTop: "2px", fontSize: "0.8rem", color: "#475569" }}>
                                                {tideChartData.currentMarker ? `Estimated height ${tideChartData.currentMarker.height.toFixed(2)} m between ${tideChartData.currentMarker.previous.type} and ${tideChartData.currentMarker.next.type}.` : "Current time sits outside the saved chart range."}
                                            </div>
                                        </div>

                                        <div
                                            style={{
                                                borderRadius: "10px",
                                                border: "1px solid #bbf7d0",
                                                background: "#f0fdf4",
                                                padding: "10px 12px",
                                            }}
                                        >
                                            <div style={{ fontSize: "0.73rem", fontWeight: 700, color: "#15803d", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                                                Next tide
                                            </div>
                                            <div style={{ marginTop: "4px", fontSize: "0.9rem", fontWeight: 700, color: "#0f172a" }}>
                                                {tideChartData.nextTide ? tideChartData.nextTide.type : "Unavailable"}
                                            </div>
                                            <div style={{ marginTop: "2px", fontSize: "0.8rem", color: "#475569" }}>
                                                {tideChartData.nextTide ? `${formatTideTime(tideChartData.nextTide.date)} • ${tideChartData.nextTide.height.toFixed(2)} m` : "No upcoming tide in this saved range."}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                            <a
                                href={LANCASTER_TIDE_CHART_URL}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                    textDecoration: "none",
                                    border: "1px solid #60a5fa",
                                    color: "#1d4ed8",
                                    background: "#fff",
                                    borderRadius: "8px",
                                    padding: isMobile ? "10px 12px" : "8px 10px",
                                    fontSize: "0.84rem",
                                    fontWeight: 700,
                                }}
                            >
                                Open Full Lancaster Chart
                            </a>
                        </div>
                    </div>
                </div>
            </div>
            </div>

            <MapContainer
                crs={L.CRS.Simple}
                bounds={bounds}
                // Add these two for better mobile touch:
                tap={true}
                touchZoom={true}
                style={{
                    height: mapHeight,
                    minHeight: isMobile ? "360px" : "400px",
                    width: "100%",
                    border: "2px solid #333",
                    borderRadius: "12px", // Rounded corners look better on mobile
                    zIndex: 0,
                }}
            >
                <ImageOverlay url="river-photo.jpg" bounds={bounds} />
                <MapEvents />

                {pendingLocation && (
                    <Marker
                        position={[pendingLocation.y, pendingLocation.x]}
                        icon={pendingPlacementIcon}
                    >
                        <Popup>
                            <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                                Pending placement location
                            </div>
                        </Popup>
                    </Marker>
                )}

                {filteredItems.map((item) => (
                    <Marker
                        key={item.id}
                        position={[item.y, item.x]}
                        icon={getIcon(item.type, getItemCounts(item).isRecovered)}
                        eventHandlers={{
                            click: () => {
                                setSelectedItemId(item.id);
                                setEditingItemId(null);
                            },
                        }}
                    />
                ))}
            </MapContainer>

            {selectedItem && selectedCounts && (
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
                            zIndex: 998,
                        }}
                    />

                    <div
                        style={{
                            position: "fixed",
                            left: isMobile ? "0" : "auto",
                            right: isMobile ? "0" : "16px",
                            bottom: isMobile ? "0" : "16px",
                            top: isMobile ? "auto" : "70px",
                            width: isMobile ? "100%" : "360px",
                            maxHeight: isMobile ? "78svh" : "calc(100vh - 86px)",
                            overflowY: "auto",
                            background: "#ffffff",
                            borderTopLeftRadius: isMobile ? "16px" : "12px",
                            borderTopRightRadius: isMobile ? "16px" : "12px",
                            borderBottomLeftRadius: isMobile ? "0" : "12px",
                            borderBottomRightRadius: "12px",
                            boxShadow: "0 18px 45px rgba(0,0,0,0.28)",
                            zIndex: 999,
                            padding: "14px",
                            boxSizing: "border-box",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: "8px",
                                marginBottom: "10px",
                            }}
                        >
                            <strong style={{ fontSize: "1.1rem", color: "#1e293b" }}>
                                {TYPE_LABELS[normalizeType(selectedItem.type)]}
                            </strong>
                            <button
                                onClick={() => {
                                    setSelectedItemId(null);
                                    setEditingItemId(null);
                                }}
                                style={{
                                    border: "1px solid #cbd5e1",
                                    background: "#fff",
                                    borderRadius: "999px",
                                    width: "34px",
                                    height: "34px",
                                    fontWeight: 700,
                                    cursor: "pointer",
                                }}
                                aria-label="Close details"
                            >
                                ×
                            </button>
                        </div>

                        {selectedItem.image_url ? (
                            <button
                                onClick={() => setIsImageViewerOpen(true)}
                                style={{
                                    border: "none",
                                    background: "transparent",
                                    width: "100%",
                                    padding: 0,
                                    cursor: "zoom-in",
                                    marginBottom: "10px",
                                }}
                            >
                                <img
                                    src={selectedItem.image_url}
                                    alt="Debris evidence"
                                    style={{
                                        width: "100%",
                                        height: "auto",
                                        borderRadius: "10px",
                                        border: "1px solid #ddd",
                                        boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                                    }}
                                />
                            </button>
                        ) : (
                            <div
                                style={{
                                    padding: "10px",
                                    color: "#999",
                                    fontSize: "0.8rem",
                                    fontStyle: "italic",
                                    marginBottom: "10px",
                                    border: "1px dashed #cbd5e1",
                                    borderRadius: "8px",
                                }}
                            >
                                No photo attached
                            </div>
                        )}

                        <div
                            style={{
                                fontSize: "0.9rem",
                                color: "#475569",
                                marginBottom: "10px",
                                lineHeight: 1.45,
                            }}
                        >
                            <div>Spotted: {new Date(selectedItem.created_at).toLocaleDateString()}</div>
                            <div>Status: {selectedCounts.isRecovered ? "✅ Recovered" : "❌ In Water"}</div>
                            <div>Total: <strong>{selectedCounts.total}</strong></div>
                            <div>Recovered: <strong>{selectedCounts.recovered}</strong></div>
                            <div>In Water: <strong>{selectedCounts.inWater}</strong></div>
                            <div>
                                Map Location: <strong>{Number(selectedItem.y).toFixed(2)}, {Number(selectedItem.x).toFixed(2)}</strong>
                            </div>
                            {selectedGps && selectedMapsUrl ? (
                                <div style={{ marginTop: "4px" }}>
                                    Image GPS: <strong>{selectedGps.latitude.toFixed(6)}, {selectedGps.longitude.toFixed(6)}</strong>{" "}
                                    <a
                                        href={selectedMapsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ color: "#1d4ed8", fontWeight: 700, textDecoration: "none" }}
                                    >
                                        Open in Maps
                                    </a>
                                </div>
                            ) : (
                                <div style={{ marginTop: "4px" }}>
                                    Image GPS: <strong>Not available</strong>
                                </div>
                            )}
                        </div>

                        <hr style={{ border: "0.5px solid #eee", margin: "8px 0 12px" }} />

                        {editingItemId === selectedItem.id ? (
                            <div style={{ textAlign: "left" }}>
                                <div style={{ marginBottom: "8px" }}>
                                    <label style={{ fontSize: "0.8rem", color: "#475569" }}>Type</label>
                                    <select
                                        value={editForm.type}
                                        onChange={(e) =>
                                            setEditForm((prev) => ({
                                                ...prev,
                                                type: e.target.value,
                                            }))
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
                                        <option value="trolley">Trolley</option>
                                        <option value="misc">Misc</option>
                                    </select>
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
                        ) : (
                            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                {!selectedCounts.isRecovered && (
                                    <button
                                        style={{
                                            flex: "1 1 100%",
                                            marginTop: "5px",
                                            padding: "10px",
                                            backgroundColor: "#2ecc71",
                                            color: "white",
                                            border: "none",
                                            borderRadius: "6px",
                                            fontWeight: "bold",
                                            cursor: "pointer",
                                            fontSize: "0.9rem",
                                        }}
                                        onClick={() => {
                                            setEditingItemId(selectedItem.id);
                                            setEditForm({
                                                type: normalizeType(selectedItem.type),
                                                total: selectedCounts.total,
                                                recovered: selectedCounts.total,
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
                                        padding: "10px",
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
                                        padding: "10px",
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
                        )}
                    </div>
                </>
            )}

            {isImageViewerOpen && selectedItem?.image_url && selectedCounts && (
                <div
                    style={{
                        position: "fixed",
                        inset: 0,
                        background: "rgba(0, 0, 0, 0.92)",
                        zIndex: 1000,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: isMobile ? "8px" : "20px",
                        boxSizing: "border-box",
                    }}
                >
                    <button
                        onClick={() => setIsImageViewerOpen(false)}
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
                        <div>
                            {TYPE_LABELS[normalizeType(selectedItem.type)]} | {selectedCounts.isRecovered ? "Recovered" : "In Water"}
                        </div>
                        <div>
                            Spotted: {new Date(selectedItem.created_at).toLocaleString()}
                        </div>
                        <div>
                            Image Location: {Number(selectedItem.y).toFixed(2)}, {Number(selectedItem.x).toFixed(2)}
                        </div>
                        {selectedGps && selectedMapsUrl ? (
                            <div>
                                Image GPS: {selectedGps.latitude.toFixed(6)}, {selectedGps.longitude.toFixed(6)} | {" "}
                                <a
                                    href={selectedMapsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: "#93c5fd", fontWeight: 700, textDecoration: "none" }}
                                >
                                    Open in Maps
                                </a>
                            </div>
                        ) : (
                            <div>Image GPS: Not available</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
