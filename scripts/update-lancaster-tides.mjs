import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const outputPath = path.join(projectRoot, "public", "lancaster-tides.json");
const sourceUrl = "https://www.tide-forecast.com/locations/Lancaster/tides/latest";

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
        if (rows.length >= 8) break;

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

const response = await fetch(sourceUrl, {
    headers: {
        "user-agent": "cleanup-tide-refresh/1.0 (+https://github.com/mrdiamonddirt/cleanup)",
    },
});

if (!response.ok) {
    throw new Error(`Failed to fetch Lancaster tide page: ${response.status} ${response.statusText}`);
}

const html = await response.text();
const rows = parseRows(html);

if (!rows.length) {
    throw new Error("No Lancaster tide rows were parsed from the source page.");
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
    outputPath,
    JSON.stringify(
        {
            location: "Lancaster, UK",
            sourceUrl,
            updatedAt: new Date().toISOString(),
            rows,
        },
        null,
        2,
    ) + "\n",
    "utf8",
);

console.log(`Updated ${outputPath} with ${rows.length} tide rows.`);