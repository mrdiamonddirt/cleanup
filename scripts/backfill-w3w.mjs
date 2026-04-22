import { createClient } from "@supabase/supabase-js";
import { resolveW3WFromCoords, normalizeW3WWords } from "../src/w3w.js";

const parseFlagValue = (flagName) => {
    const arg = process.argv.find((entry) => entry.startsWith(`${flagName}=`));
    if (!arg) return "";
    return arg.slice(flagName.length + 1).trim();
};

const parsePositiveIntFlag = (flagName, fallback) => {
    const raw = parseFlagValue(flagName);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const dryRun = process.argv.includes("--dry-run");
const limitPerTable = parsePositiveIntFlag("--limit", 0);
const delayMs = parsePositiveIntFlag("--delay-ms", 350);
const maxRetries = parsePositiveIntFlag("--retries", 2);

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const supabaseKey = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    ""
).trim();
const w3wApiKey = (process.env.W3W_API_KEY || process.env.VITE_W3W_API_KEY || "").trim();

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
}

if (!w3wApiKey) {
    console.error("Missing What3Words API key. Set W3W_API_KEY or VITE_W3W_API_KEY.");
    process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("SUPABASE_SERVICE_ROLE_KEY not set; falling back to anon key may fail under RLS.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
    },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hasMissingW3W = (value) => !normalizeW3WWords(value);

const pickItemCoords = (row) => {
    const gpsLat = Number(row?.gps_latitude);
    const gpsLng = Number(row?.gps_longitude);
    if (Number.isFinite(gpsLat) && Number.isFinite(gpsLng)) {
        return { latitude: gpsLat, longitude: gpsLng };
    }

    const markerLat = Number(row?.y);
    const markerLng = Number(row?.x);
    if (Number.isFinite(markerLat) && Number.isFinite(markerLng)) {
        return { latitude: markerLat, longitude: markerLng };
    }

    return null;
};

const fetchItemsNeedingBackfill = async () => {
    const { data, error } = await supabase
        .from("items")
        .select("id, x, y, gps_latitude, gps_longitude, w3w_address");

    if (error) {
        throw new Error(`Could not read items: ${error.message || error}`);
    }

    const rows = Array.isArray(data) ? data : [];
    return rows
        .filter((row) => hasMissingW3W(row?.w3w_address))
        .map((row) => ({
            id: row.id,
            table: "items",
            coords: pickItemCoords(row),
            currentW3W: row.w3w_address,
        }))
        .filter((entry) => entry.coords !== null);
};

const fetchPoisNeedingBackfill = async () => {
    const { data, error } = await supabase
        .from("pois")
        .select("id, latitude, longitude, w3w_address");

    if (error) {
        throw new Error(`Could not read POIs: ${error.message || error}`);
    }

    const rows = Array.isArray(data) ? data : [];
    return rows
        .filter((row) => hasMissingW3W(row?.w3w_address))
        .map((row) => ({
            id: row.id,
            table: "pois",
            coords: {
                latitude: Number(row.latitude),
                longitude: Number(row.longitude),
            },
            currentW3W: row.w3w_address,
        }))
        .filter(
            (entry) =>
                Number.isFinite(entry.coords.latitude) &&
                Number.isFinite(entry.coords.longitude) &&
                entry.coords.latitude >= -90 &&
                entry.coords.latitude <= 90 &&
                entry.coords.longitude >= -180 &&
                entry.coords.longitude <= 180,
        );
};

const updateRowW3W = async (table, id, w3wAddress) => {
    const payload = {
        w3w_address: w3wAddress,
        w3w_updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
        .from(table)
        .update(payload)
        .eq("id", id);

    if (error) {
        throw new Error(`Could not update ${table}.${id}: ${error.message || error}`);
    }
};

const resolveWithRetry = async (coords) => {
    let attempt = 0;

    while (attempt <= maxRetries) {
        try {
            return await resolveW3WFromCoords({
                latitude: coords.latitude,
                longitude: coords.longitude,
                apiKey: w3wApiKey,
            });
        } catch (error) {
            if (attempt >= maxRetries) {
                throw error;
            }

            const backoffMs = delayMs * (attempt + 1);
            await sleep(backoffMs);
            attempt += 1;
        }
    }

    return "";
};

const coordCache = new Map();
const getCoordKey = (coords) => `${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`;

const applyLimit = (rows) => {
    if (!limitPerTable || limitPerTable <= 0) return rows;
    return rows.slice(0, limitPerTable);
};

const summary = {
    scanned: 0,
    skipped: 0,
    updated: 0,
    failed: 0,
    apiCalls: 0,
};

const processRows = async (rows, label) => {
    console.log(`Found ${rows.length} ${label} row(s) needing W3W.`);

    for (const row of rows) {
        summary.scanned += 1;

        const coordKey = getCoordKey(row.coords);
        let words = coordCache.get(coordKey);

        if (words === undefined) {
            try {
                words = await resolveWithRetry(row.coords);
                summary.apiCalls += 1;
                coordCache.set(coordKey, words || "");
            } catch (error) {
                summary.failed += 1;
                console.warn(`Failed to resolve W3W for ${row.table}.${row.id}: ${error.message || error}`);
                if (delayMs > 0) await sleep(delayMs);
                continue;
            }
        }

        if (!words) {
            summary.skipped += 1;
            if (delayMs > 0) await sleep(delayMs);
            continue;
        }

        if (dryRun) {
            summary.updated += 1;
            console.log(`[dry-run] Would update ${row.table}.${row.id} -> ///${words}`);
            if (delayMs > 0) await sleep(delayMs);
            continue;
        }

        try {
            await updateRowW3W(row.table, row.id, words);
            summary.updated += 1;
        } catch (error) {
            summary.failed += 1;
            console.warn(error.message || error);
        }

        if (delayMs > 0) await sleep(delayMs);
    }
};

const main = async () => {
    console.log("Starting one-off W3W backfill...");
    console.log(`Mode: ${dryRun ? "dry-run" : "live"}`);
    console.log(`Delay per row: ${delayMs} ms`);
    console.log(`Retry count: ${maxRetries}`);

    const [items, pois] = await Promise.all([
        fetchItemsNeedingBackfill(),
        fetchPoisNeedingBackfill(),
    ]);

    const limitedItems = applyLimit(items);
    const limitedPois = applyLimit(pois);

    await processRows(limitedItems, "item");
    await processRows(limitedPois, "POI");

    console.log("Backfill complete.");
    console.log(`Scanned: ${summary.scanned}`);
    console.log(`Updated: ${summary.updated}`);
    console.log(`Skipped: ${summary.skipped}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`API calls: ${summary.apiCalls}`);
};

main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
});
