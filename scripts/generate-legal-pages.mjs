import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const legalRoot = path.join(publicDir, "legal");

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

const formatDate = (date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
};

const buildLegalPageHtml = ({ siteUrl, canonicalPath, title, description, bodyHtml, updatedAt }) => {
    const canonicalUrl = `${siteUrl}${canonicalPath}`;

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0b132b" />
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index, follow" />

    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="River Bank Cleanup Tracker" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}" />

    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />

    <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; color: #0f172a; background: radial-gradient(circle at top right, #dbeafe, #eff6ff 35%, #f8fafc 70%);">
    <main style="max-width: 780px; margin: 0 auto; padding: 28px 18px 40px;">
      <article style="background: #ffffff; border: 1px solid #dbeafe; border-radius: 14px; box-shadow: 0 16px 40px rgba(15, 23, 42, 0.08); overflow: hidden;">
        <header style="padding: 20px 22px 14px; background: linear-gradient(130deg, #0b132b, #1d4ed8); color: #f8fafc;">
          <h1 style="margin: 0; font-size: 1.6rem; line-height: 1.3;">${escapeHtml(title)}</h1>
          <p style="margin: 10px 0 0; font-size: 0.92rem; opacity: 0.9;">Last updated: ${escapeHtml(updatedAt)}</p>
        </header>
        <section style="padding: 22px; line-height: 1.65; font-size: 1rem;">
${bodyHtml}
        </section>
      </article>
    </main>
  </body>
</html>
`;
};

const main = async () => {
    const localEnv = await readLocalDotEnv();
    const siteUrl = stripTrailingSlashes(
        process.env.SEO_SITE_URL ||
            process.env.SITE_URL ||
            process.env.VITE_SITE_URL ||
            localEnv.SEO_SITE_URL ||
            localEnv.SITE_URL ||
            localEnv.VITE_SITE_URL ||
            "https://rivercleanup.co.uk",
    );
    const updatedAt = formatDate(new Date());

    const pages = [
        {
            slug: "privacy-policy",
            canonicalPath: "/legal/privacy-policy/",
            title: "Privacy Policy | River Bank Cleanup Tracker",
            description: "How River Bank Cleanup Tracker collects, uses, and protects personal information.",
            bodyHtml: `          <p>This Privacy Policy explains how River Bank Cleanup Tracker handles personal data when you use the app and related services.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">Information We Collect</h2>
          <p>We may collect account information you provide, content you submit in the app, and technical usage data needed to operate and secure the service.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">How We Use Information</h2>
          <p>We use information to provide core functionality, improve reliability, support community moderation, and communicate important service updates.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">Data Sharing</h2>
          <p>We do not sell personal data. We share information only when needed to run the service, comply with legal obligations, or protect users and the public.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">Data Retention</h2>
          <p>We retain data only for as long as required for service operations, legal compliance, and safety obligations. You can request deletion of eligible account data.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">Contact</h2>
          <p>For privacy questions, contact us through the main project contact channels listed in the app.</p>`,
        },
        {
            slug: "terms-of-service",
            canonicalPath: "/legal/terms-of-service/",
            title: "Terms of Service | River Bank Cleanup Tracker",
            description: "Terms governing use of River Bank Cleanup Tracker and related services.",
            bodyHtml: `          <p>These Terms of Service govern your use of River Bank Cleanup Tracker. By using the service, you agree to these terms.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">Acceptable Use</h2>
          <p>You agree to use the service lawfully, avoid abusive behavior, and avoid submitting content that is harmful, deceptive, or infringes rights.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">User Content</h2>
          <p>You are responsible for content you submit. You confirm you have rights to submit that content and grant us permission to display it for service operation.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">Service Availability</h2>
          <p>We aim to keep the service available but do not guarantee uninterrupted access. Features may change or be discontinued as needed.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">Limitation of Liability</h2>
          <p>To the fullest extent permitted by law, the service is provided as-is without warranties, and liability is limited for indirect or consequential damages.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">Changes</h2>
          <p>We may update these terms from time to time. Continued use after updates means you accept the revised terms.</p>`,
        },
        {
            slug: "data-deletion",
            canonicalPath: "/legal/data-deletion/",
            title: "User Data Deletion Instructions | River Bank Cleanup Tracker",
            description: "Instructions for requesting deletion of personal data used by River Bank Cleanup Tracker.",
            bodyHtml: `          <p>If you want your personal data deleted, follow the steps below. This page is provided for platform compliance, including Facebook app settings.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">How To Request Deletion</h2>
          <ol style="padding-left: 20px;">
            <li>Open your account profile inside the app.</li>
            <li>Use the account deletion or data deletion request option, if shown.</li>
            <li>If you cannot access your account, submit a request through the project contact channels listed in the app and include your account identifier.</li>
          </ol>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">Verification</h2>
          <p>We may ask for information to verify account ownership before processing deletion requests.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">What Gets Deleted</h2>
          <p>We delete or anonymize personal account data where legally permitted. Some records may be retained when required for legal compliance, fraud prevention, or safety.</p>
          <h2 style="margin-top: 22px; font-size: 1.2rem;">Processing Time</h2>
          <p>Deletion requests are processed within a reasonable timeframe after verification. If retention is required, we will limit use of retained data.</p>`,
        },
    ];

    for (const page of pages) {
        const folder = path.join(legalRoot, page.slug);
        await mkdir(folder, { recursive: true });

        const html = buildLegalPageHtml({
            siteUrl,
            canonicalPath: page.canonicalPath,
            title: page.title,
            description: page.description,
            bodyHtml: page.bodyHtml,
            updatedAt,
        });

        await writeFile(path.join(folder, "index.html"), html, "utf8");
    }

    console.log(`Generated ${pages.length} legal pages in ${legalRoot}.`);
};

await main();
