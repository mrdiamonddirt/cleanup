import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputPath = path.join(projectRoot, "public", "lancaster-tides.json");
const sourceUrl = "https://www.tide-forecast.com/locations/Lancaster/tides/latest";
const DAILY_UPDATE_HOURS = 24;
const RETAIN_PAST_HOURS = 30;
const RETAIN_FUTURE_HOURS = 132;

const forceRefresh = process.argv.includes("--force");

const stripHtml = (value) =>
    value
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/\s+/g, " ")
        .trim();

const parseRows = (html) => {
    const rows = [];
    const seen = new Set();
    const tableRows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

    for (const rowHtml of tableRows) {
        if (rows.length >= 20) break;

        const cells = Array.from(rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi))
            .map((match) => stripHtml(match[1]))
            .filter(Boolean);

        if (cells.length < 3) continue;

        const [type, time, height] = cells;
        if (!/(High Tide|Low Tide)/i.test(type)) continue;

        const key = `${type}|${time}|${height}`;
        if (seen.has(key)) continue;

        seen.add(key);
        rows.push({ type, time, height });
    }

    return rows;
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
    else if (/^PM$/i.test(period)) hours += 12;

    return new Date(year, monthIndex, day, hours, minutes, 0, 0);
};

const normalizeTideType = (typeText) => {
    if (!typeText) return "";
    if (/high tide/i.test(typeText)) return "High Tide";
    if (/low tide/i.test(typeText)) return "Low Tide";
    return typeText.trim();
};

const parseHeightMeters = (heightText) => {
    if (!heightText) return null;
    const match = heightText.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
};

const toEvent = (row, fallbackYear) => {
    const type = normalizeTideType(row?.type || "");
    const time = typeof row?.time === "string" ? row.time.trim() : "";
    const height = typeof row?.height === "string" ? row.height.trim() : "";
    const date = parseLancasterTideDate(time, fallbackYear);
    const timestamp = date?.getTime() ?? null;
    const heightMeters = parseHeightMeters(height);

    const key = Number.isFinite(timestamp)
        ? `${type}|${timestamp}|${heightMeters ?? "na"}`
        : `${type}|${time}|${height}`;

    return {
        key,
        type,
        time,
        height,
        timestamp,
        row: {
            type,
            time,
            height,
        },
    };
};

const safeReadExistingSnapshot = async () => {
    try {
        const raw = await readFile(outputPath, "utf8");
        const parsed = JSON.parse(raw);

        return {
            updatedAt:
                typeof parsed?.updatedAt === "string" && parsed.updatedAt.trim()
                    ? parsed.updatedAt
                    : null,
            rows: Array.isArray(parsed?.rows) ? parsed.rows : [],
        };
    } catch {
        return {
            updatedAt: null,
            rows: [],
        };
    }
};

const shouldSkipDailyRefresh = (existingUpdatedAt) => {
    if (!existingUpdatedAt || forceRefresh) return false;

    const lastUpdatedMs = new Date(existingUpdatedAt).getTime();
    if (!Number.isFinite(lastUpdatedMs)) return false;

    const ageHours = (Date.now() - lastUpdatedMs) / (60 * 60 * 1000);
    return ageHours < DAILY_UPDATE_HOURS;
};

const existingSnapshot = await safeReadExistingSnapshot();

if (shouldSkipDailyRefresh(existingSnapshot.updatedAt)) {
    const lastUpdated = new Date(existingSnapshot.updatedAt).toISOString();
    console.log(
        `Skipping refresh. Existing snapshot is newer than ${DAILY_UPDATE_HOURS}h (updatedAt: ${lastUpdated}). Use --force to override.`,
    );
    process.exit(0);
}

const response = await fetch(sourceUrl, {
    headers: {
        "user-agent": "cleanup-tide-refresh/1.0 (+https://github.com/mrdiamonddirt/cleanup)",
    },
});

if (!response.ok) {
    throw new Error(`Failed to fetch Lancaster tide page: ${response.status} ${response.statusText}`);
}

const html = await response.text();
const fetchedRows = parseRows(html);

if (!fetchedRows.length) {
    throw new Error("No Lancaster tide rows were parsed from the source page.");
}

const fallbackYear = new Date().getFullYear();
const mergedEvents = new Map();

for (const row of [...existingSnapshot.rows, ...fetchedRows]) {
    const event = toEvent(row, fallbackYear);
    if (!event.type || !event.time || !event.height) continue;

    if (mergedEvents.has(event.key)) mergedEvents.delete(event.key);
    mergedEvents.set(event.key, event);
}

const allMerged = Array.from(mergedEvents.values()).sort((left, right) => {
    const leftTime = left.timestamp;
    const rightTime = right.timestamp;

    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
    if (Number.isFinite(leftTime)) return -1;
    if (Number.isFinite(rightTime)) return 1;
    return left.time.localeCompare(right.time);
});

const nowMs = Date.now();
const retainStartMs = nowMs - RETAIN_PAST_HOURS * 60 * 60 * 1000;
const retainEndMs = nowMs + RETAIN_FUTURE_HOURS * 60 * 60 * 1000;

let retainedEvents = allMerged.filter((event) => {
    if (!Number.isFinite(event.timestamp)) return true;
    return event.timestamp >= retainStartMs && event.timestamp <= retainEndMs;
});

if (retainedEvents.length < 2) {
    retainedEvents = allMerged.slice(-30);
}

const timestamps = retainedEvents
    .map((event) => event.timestamp)
    .filter((value) => Number.isFinite(value));

const coverageStart = timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null;
const coverageEnd = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
const rows = retainedEvents.map((event) => event.row);

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
    outputPath,
    JSON.stringify(
        {
            location: "Lancaster, UK",
            sourceUrl,
            updatedAt: new Date().toISOString(),
            metadata: {
                mergedFromExistingRows: existingSnapshot.rows.length,
                mergedFromFetchedRows: fetchedRows.length,
                retainedRows: rows.length,
                retentionHours: {
                    past: RETAIN_PAST_HOURS,
                    future: RETAIN_FUTURE_HOURS,
                },
                coverageStart,
                coverageEnd,
            },
            rows,
        },
        null,
        2,
    ) + "\n",
    "utf8",
);

console.log(
    `Updated ${outputPath} with ${rows.length} merged rows (${existingSnapshot.rows.length} previous + ${fetchedRows.length} fetched).`,
);