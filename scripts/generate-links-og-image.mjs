import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const publicDir = path.join(projectRoot, "public");
const outputPath = path.join(publicDir, "links-og.png");
const fallbackImagePath = path.join(publicDir, "river-photo.jpg");

const SERVER_PORT = 4173;
const SERVER_URL = `http://127.0.0.1:${SERVER_PORT}`;
const PAGE_URL = `${SERVER_URL}/links/`;
const SCREENSHOT_WIDTH = 1200;
const SCREENSHOT_HEIGHT = 630;
const PAGE_READY_TIMEOUT_MS = 12000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createLinksScreenshot = async () => {
    const server = await createServer({
        root: projectRoot,
        logLevel: "error",
        server: {
            host: "127.0.0.1",
            port: SERVER_PORT,
            strictPort: true,
        },
    });

    try {
        await server.listen();
        await delay(120);

        const browser = await chromium.launch({ headless: true });

        try {
            const context = await browser.newContext({
                viewport: {
                    width: SCREENSHOT_WIDTH,
                    height: SCREENSHOT_HEIGHT,
                },
            });

            const page = await context.newPage();
            await page.goto(PAGE_URL, { waitUntil: "networkidle", timeout: PAGE_READY_TIMEOUT_MS });
            await page.waitForSelector("main", { state: "visible", timeout: PAGE_READY_TIMEOUT_MS });

            await page.waitForFunction(
                () => {
                    const readyState = document.fonts?.status;
                    return readyState === "loaded" || !document.fonts;
                },
                { timeout: 6000 },
            );

            await page
                .waitForFunction(
                    () => {
                        const weight = document.getElementById("weight-total")?.textContent || "";
                        const breakdown = document.getElementById("item-breakdown")?.textContent || "";
                        return !/Loading/i.test(weight) && !/Loading/i.test(breakdown);
                    },
                    { timeout: 4000 },
                )
                .catch(() => {
                    // Dynamic stats can be unavailable in some environments; keep going with rendered fallback text.
                });

            await page.addStyleTag({
                content: `
                    body { padding: 0 !important; }
                    main { width: 100% !important; max-width: 860px !important; }
                `,
            });

            await mkdir(publicDir, { recursive: true });
            await page.screenshot({
                path: outputPath,
                type: "png",
            });

            console.log("[og] Generated public/links-og.png");
            await context.close();
        } finally {
            await browser.close();
        }
    } finally {
        await server.close();
    }
};

const writeFallbackImage = async () => {
    await mkdir(publicDir, { recursive: true });
    await copyFile(fallbackImagePath, outputPath);
    console.warn("[og] Screenshot generation failed. Falling back to public/river-photo.jpg for links-og.png");
};

try {
    await createLinksScreenshot();
} catch (error) {
    console.error("[og] Failed to generate links OG screenshot:", error);

    try {
        await writeFallbackImage();
    } catch (fallbackError) {
        console.error("[og] Failed to write fallback links OG image:", fallbackError);
        process.exitCode = 1;
    }
}
