import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");

const stripTrailingSlashes = (value) => value.replace(/\/+$/, "");

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
    const { readFile } = await import("node:fs/promises");
    const dotEnvPath = path.join(projectRoot, ".env");

    try {
        const raw = await readFile(dotEnvPath, "utf8");
        return parseDotEnv(raw);
    } catch {
        return {};
    }
};

const buildSitemapXml = (urls) => {
    const urlEntries = urls
        .map(
            (url) => `  <url>
    <loc>${url}</loc>
    <changefreq>weekly</changefreq>
  </url>`,
        )
        .join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
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

    const urls = [
        `${siteUrl}/`,
        `${siteUrl}/links/`,
        `${siteUrl}/legal/privacy-policy/`,
        `${siteUrl}/legal/terms-of-service/`,
        `${siteUrl}/legal/data-deletion/`,
    ];

    if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey, {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        });

        const { data, error } = await supabase
            .from("items")
            .select("id")
            .order("created_at", { ascending: false })
            .limit(500);

        if (error) {
            console.warn(`Sitemap: Failed to fetch items: ${error.message}`);
        } else {
            const items = Array.isArray(data)
                ? data.filter((item) => item && item.id !== null && item.id !== undefined)
                : [];

            for (const item of items) {
                const id = String(item.id).trim();
                if (id) {
                    urls.push(`${siteUrl}/share/${encodeURIComponent(id)}/`);
                }
            }
        }

        const { data: historicalData, error: historicalError } = await supabase
            .from("pois")
            .select("slug")
            .eq("status", "published")
            .eq("is_public", true)
            .order("updated_at", { ascending: false })
            .limit(500);

        if (historicalError) {
            const message = String(historicalError.message || "").toLowerCase();
            const missingHistoricalTable =
                message.includes("pois") &&
                (message.includes("could not find") || message.includes("does not exist"));

            if (missingHistoricalTable) {
                console.warn("Sitemap: pois table missing, skipping POI URLs.");
            } else {
                console.warn(`Sitemap: Failed to fetch historical POIs: ${historicalError.message}`);
            }
        } else {
            const historicalPois = Array.isArray(historicalData)
                ? historicalData.filter((poi) => poi && typeof poi.slug === "string" && poi.slug.trim())
                : [];

            for (const poi of historicalPois) {
                const slug = String(poi.slug).trim();
                if (slug) {
                    urls.push(`${siteUrl}/poi/${encodeURIComponent(slug)}/`);
                }
            }
        }
    } else {
        console.warn("Sitemap: Skipped item URLs - Supabase env vars are missing.");
    }

    const sitemapContent = buildSitemapXml(urls);
    const sitemapPath = path.join(publicDir, "sitemap.xml");

    await writeFile(sitemapPath, sitemapContent, "utf8");
    console.log(`Generated sitemap with ${urls.length} URLs at ${sitemapPath}`);
};

await main();
