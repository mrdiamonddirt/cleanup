import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const shareRoot = path.join(publicDir, "share");
const poiRoot = path.join(publicDir, "poi");
const legacyHistoryRoot = path.join(publicDir, "history");
const fallbackImage = "/river-photo.jpg";

const TYPE_LABELS = {
    bike: "Bike",
    motorbike: "Motorbike",
    trolley: "Trolley",
    misc: "Misc",
};

const normalizeType = (value) => {
    if (typeof value !== "string") return "misc";
    const normalized = value.trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(TYPE_LABELS, normalized) ? normalized : "misc";
};

const stripTrailingSlashes = (value) => value.replace(/\/+$/, "");

const escapeHtml = (value) =>
    String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

const parseDotEnv = (raw) => {
    const env = {};

    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        if (key) env[key] = value;
    }

    return env;
};

const readLocalDotEnv = async () => {
    const dotEnvPath = path.join(projectRoot, ".env");

    try {
        const raw = await readFile(dotEnvPath, "utf8");
        return parseDotEnv(raw);
    } catch {
        return {};
    }
};

const ensureAbsoluteUrl = (siteUrl, maybeUrl) => {
    if (!maybeUrl) return `${siteUrl}${fallbackImage}`;

    const candidate = String(maybeUrl).trim();
    if (!candidate) return `${siteUrl}${fallbackImage}`;

    if (/^https?:\/\//i.test(candidate)) return candidate;
    if (candidate.startsWith("/")) return `${siteUrl}${candidate}`;
    return `${siteUrl}/${candidate}`;
};

const toItemDescription = (item, typeLabel) => {
    const recoveredCount = Number.isFinite(Number(item.recovered_count))
        ? Number(item.recovered_count)
        : 0;
    const totalCount = Number.isFinite(Number(item.total_count))
        ? Number(item.total_count)
        : 1;
    const status = recoveredCount >= totalCount ? "Recovered" : "In Water";

    const locationBits = [];
    if (typeof item.geocode_label === "string" && item.geocode_label.trim()) {
        locationBits.push(item.geocode_label.trim());
    }
    if (Number.isFinite(Number(item.y)) && Number.isFinite(Number(item.x))) {
        locationBits.push(`GPS ${Number(item.y).toFixed(5)}, ${Number(item.x).toFixed(5)}`);
    }

    const spottedDate = item.created_at
        ? new Date(item.created_at)
        : null;
    const spottedText = spottedDate && !Number.isNaN(spottedDate.getTime())
        ? `Spotted ${spottedDate.toUTCString()}`
        : "Spotted date unavailable";

    const locationText = locationBits.length ? `Location: ${locationBits.join(" | ")}.` : "";
    return `${typeLabel} cleanup item. Status: ${status}. ${spottedText}. ${locationText}`.trim();
};

const buildShareHtml = ({ siteUrl, shareUrl, appUrl, ogImageUrl, title, description, item }) => {
    const itemType = TYPE_LABELS[normalizeType(item.type)] || "Cleanup Item";
    const jsonLd = {
        "@context": "https://schema.org",
        "@type": "CreativeWork",
        "name": title,
        "url": shareUrl,
        "description": description,
        "image": ogImageUrl,
        "about": itemType,
    };

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0f172a" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow" />

    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="River Bank Cleanup Tracker" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(shareUrl)}" />
    <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
    <meta property="og:image:alt" content="Cleanup tracker item preview" />

    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />

    <link rel="canonical" href="${escapeHtml(shareUrl)}" />

    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; padding: 24px; background: #f8fafc; color: #0f172a;">
    <main style="max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 20px; box-shadow: 0 12px 26px rgba(15, 23, 42, 0.08);">
      <h1 style="margin-top: 0; font-size: 1.45rem; line-height: 1.3;">${escapeHtml(title)}</h1>
      <p style="margin: 0 0 14px; line-height: 1.5;">${escapeHtml(description)}</p>
      <p style="margin: 0;">
        <a href="${escapeHtml(appUrl)}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; padding: 10px 14px; border-radius: 10px; font-weight: 600;">Open In Cleanup Tracker</a>
      </p>
    </main>
  </body>
</html>
`;
};

const buildIndexHtml = ({ siteUrl, itemCount }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Share pages for River Bank Cleanup Tracker items." />
    <meta name="robots" content="index, follow" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="River Bank Cleanup Tracker Share Pages" />
    <meta property="og:description" content="Auto-generated crawler-friendly pages for cleanup item links." />
    <meta property="og:url" content="${escapeHtml(`${siteUrl}/share/`)}" />
    <meta property="og:image" content="${escapeHtml(`${siteUrl}${fallbackImage}`)}" />
    <link rel="canonical" href="${escapeHtml(`${siteUrl}/share/`)}" />
    <title>Cleanup Share Pages</title>
  </head>
  <body style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; margin: 24px;">
    <h1>Cleanup Share Pages</h1>
    <p>Generated item pages: ${itemCount}</p>
    <p><a href="${escapeHtml(siteUrl)}">Open main tracker</a></p>
  </body>
</html>
`;

const buildPoiHtml = ({
        siteUrl,
    poiUrl,
        appUrl,
        ogImageUrl,
        title,
        description,
        poi,
}) => {
        const images = Array.isArray(poi?.poi_images) ? poi.poi_images : [];
        const imageGallery = images.slice(0, 4).map((image) => {
                const src = ensureAbsoluteUrl(siteUrl, image?.image_url || "");
                const alt = escapeHtml(image?.alt_text || `${poi?.title || "Historical reference"} image`);
                const caption = escapeHtml(image?.caption || "");

                return `<figure style="margin:0; display:grid; gap:6px;">
    <img src="${escapeHtml(src)}" alt="${alt}" style="width:100%; border-radius:10px; border:1px solid #fed7aa; max-height:280px; object-fit:cover;" />
    ${caption ? `<figcaption style="font-size:0.86rem; color:#7c2d12;">${caption}</figcaption>` : ""}
</figure>`;
        }).join("\n");

        const jsonLd = {
                "@context": "https://schema.org",
                "@type": "Place",
                "name": title,
                "url": poiUrl,
                "description": description,
                "image": ogImageUrl,
                "geo": {
                        "@type": "GeoCoordinates",
                        "latitude": poi?.latitude,
                        "longitude": poi?.longitude,
                },
        };

        return `<!doctype html>
<html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="theme-color" content="#7c2d12" />
        <meta name="description" content="${escapeHtml(description)}" />
        <meta name="robots" content="index, follow" />

        <meta property="og:type" content="article" />
        <meta property="og:site_name" content="River Bank Cleanup Tracker" />
        <meta property="og:title" content="${escapeHtml(title)}" />
        <meta property="og:description" content="${escapeHtml(description)}" />
        <meta property="og:url" content="${escapeHtml(poiUrl)}" />
        <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
        <meta property="og:image:alt" content="POI image" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="${escapeHtml(title)}" />
        <meta name="twitter:description" content="${escapeHtml(description)}" />
        <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />

        <link rel="canonical" href="${escapeHtml(poiUrl)}" />

        <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
        <title>${escapeHtml(title)}</title>
    </head>
    <body style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; margin: 0; padding: 24px; background: #fff7ed; color: #0f172a;">
        <main style="max-width: 760px; margin: 0 auto; background: #ffffff; border-radius: 14px; padding: 22px; box-shadow: 0 12px 26px rgba(124, 45, 18, 0.12); border: 1px solid #fed7aa; display: grid; gap: 14px;">
            <h1 style="margin: 0; font-size: 1.5rem; line-height: 1.3; color: #7c2d12;">${escapeHtml(title)}</h1>
            <p style="margin: 0; line-height: 1.6; color: #334155;">${escapeHtml(description)}</p>
            ${imageGallery}
            <p style="margin: 0;">
                <a href="${escapeHtml(appUrl)}" style="display: inline-block; background: #7c2d12; color: #ffffff; text-decoration: none; padding: 10px 14px; border-radius: 10px; font-weight: 600;">Open In Cleanup Tracker</a>
            </p>
        </main>
    </body>
</html>
`;
};

const main = async () => {
    const localEnv = await readLocalDotEnv();
    const supabaseUrl =
        process.env.SUPABASE_URL ||
        process.env.VITE_SUPABASE_URL ||
        localEnv.SUPABASE_URL ||
        localEnv.VITE_SUPABASE_URL ||
        "";
    const supabaseKey =
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_ANON_KEY ||
        process.env.VITE_SUPABASE_ANON_KEY ||
        localEnv.SUPABASE_SERVICE_ROLE_KEY ||
        localEnv.SUPABASE_ANON_KEY ||
        localEnv.VITE_SUPABASE_ANON_KEY ||
        "";
    const siteUrl = stripTrailingSlashes(
        process.env.SEO_SITE_URL ||
        process.env.SITE_URL ||
        process.env.VITE_SITE_URL ||
        localEnv.SEO_SITE_URL ||
        localEnv.SITE_URL ||
        localEnv.VITE_SITE_URL ||
        "https://rivercleanup.co.uk",
    );

    await rm(shareRoot, { recursive: true, force: true });
    await mkdir(shareRoot, { recursive: true });
    await rm(poiRoot, { recursive: true, force: true });
    await mkdir(poiRoot, { recursive: true });
    await rm(legacyHistoryRoot, { recursive: true, force: true });

    if (!supabaseUrl || !supabaseKey) {
        const indexHtml = buildIndexHtml({ siteUrl, itemCount: 0 });
        await writeFile(path.join(shareRoot, "index.html"), indexHtml, "utf8");
        await writeFile(path.join(poiRoot, "index.html"), buildIndexHtml({ siteUrl, itemCount: 0 }), "utf8");
        console.warn("Skipped SEO share page generation: Supabase env vars are missing.");
        return;
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });

    const { data, error } = await supabase
        .from("items")
        .select("id,type,image_url,created_at,total_count,recovered_count,x,y,geocode_label")
        .order("created_at", { ascending: false })
        .limit(500);

    if (error) {
        throw new Error(`Failed to fetch items for SEO prerender: ${error.message}`);
    }

    const items = Array.isArray(data) ? data.filter((item) => item && item.id !== null && item.id !== undefined) : [];

    const { data: historicalData, error: historicalError } = await supabase
        .from("pois")
        .select(`
            id,
            slug,
            title,
            summary,
            description,
            latitude,
            longitude,
            is_historic,
            updated_at,
            poi_images (
                image_url,
                alt_text,
                caption,
                display_order,
                is_featured
            )
        `)
        .eq("status", "published")
        .eq("is_public", true)
        .order("updated_at", { ascending: false })
        .limit(500);

    let historicalPois = [];
    if (historicalError) {
        const message = String(historicalError.message || "").toLowerCase();
        const missingHistoricalTable =
            message.includes("pois") &&
            (message.includes("could not find") || message.includes("does not exist"));

        if (missingHistoricalTable) {
            console.warn("POI SEO generation skipped: pois table is missing.");
        } else {
            throw new Error(`Failed to fetch historical POIs for SEO prerender: ${historicalError.message}`);
        }
    } else {
        historicalPois = Array.isArray(historicalData)
            ? historicalData.filter((poi) => poi && typeof poi.slug === "string" && poi.slug.trim())
            : [];
    }

    for (const item of items) {
        const id = String(item.id).trim();
        if (!id) continue;

        const typeLabel = TYPE_LABELS[normalizeType(item.type)] || "Cleanup Item";
        const title = `${typeLabel} cleanup item #${id} | River Bank Cleanup Tracker`;
        const description = toItemDescription(item, typeLabel);
        const shareUrl = `${siteUrl}/share/${encodeURIComponent(id)}/`;
        const appUrl = `${siteUrl}/?item=${encodeURIComponent(id)}`;
        const ogImageUrl = ensureAbsoluteUrl(siteUrl, item.image_url);

        const folder = path.join(shareRoot, encodeURIComponent(id));
        await mkdir(folder, { recursive: true });
        await writeFile(
            path.join(folder, "index.html"),
            buildShareHtml({ siteUrl, shareUrl, appUrl, ogImageUrl, title, description, item }),
            "utf8",
        );
    }

    await writeFile(path.join(shareRoot, "index.html"), buildIndexHtml({ siteUrl, itemCount: items.length }), "utf8");

    for (const poi of historicalPois) {
        const slug = String(poi.slug).trim();
        if (!slug) continue;

        const sortedImages = Array.isArray(poi.poi_images)
            ? [...poi.poi_images].sort(
                (left, right) => Number(left?.display_order || 0) - Number(right?.display_order || 0),
            )
            : [];
        const featuredImage = sortedImages.find((image) => image?.is_featured) || sortedImages[0] || null;
        const title = `${poi.title || "POI"} | River Lune POI`;
        const contextText = poi?.is_historic ? "Historic POI" : "POI";
        const description = (poi.summary || poi.description || `${contextText} on the River Lune cleanup map.`).trim();
        const poiUrl = `${siteUrl}/poi/${encodeURIComponent(slug)}/`;
        const appUrl = `${siteUrl}/?poi=${encodeURIComponent(slug)}`;
        const ogImageUrl = ensureAbsoluteUrl(siteUrl, featuredImage?.image_url || "");

        const folder = path.join(poiRoot, encodeURIComponent(slug));
        await mkdir(folder, { recursive: true });
        await writeFile(
            path.join(folder, "index.html"),
            buildPoiHtml({
                siteUrl,
                poiUrl,
                appUrl,
                ogImageUrl,
                title,
                description,
                poi: {
                    ...poi,
                    poi_images: sortedImages,
                },
            }),
            "utf8",
        );
    }

    await writeFile(path.join(poiRoot, "index.html"), buildIndexHtml({ siteUrl, itemCount: historicalPois.length }), "utf8");

    const shareFolders = await readdir(shareRoot, { withFileTypes: true });
    const generatedPages = shareFolders.filter((entry) => entry.isDirectory()).length;
    const poiFolders = await readdir(poiRoot, { withFileTypes: true });
    const generatedPoiPages = poiFolders.filter((entry) => entry.isDirectory()).length;
    console.log(`Generated ${generatedPages} SEO share pages in ${shareRoot}.`);
    console.log(`Generated ${generatedPoiPages} SEO POI pages in ${poiRoot}.`);
};

await main();