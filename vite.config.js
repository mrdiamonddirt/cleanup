import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const SEO_ROUTE_PATTERN = /^\/(poi|share)\/[^/]+\/?$/;
const STATIC_INDEX_ROUTES = new Map([
    [/^\/links\/?$/, "/links/index.html"],
    [/^\/legal\/privacy-policy\/?$/, "/legal/privacy-policy/index.html"],
    [/^\/legal\/terms-of-service\/?$/, "/legal/terms-of-service/index.html"],
    [/^\/legal\/data-deletion\/?$/, "/legal/data-deletion/index.html"],
]);

const rewriteSeoRouteToStaticIndex = (req, _res, next) => {
    const requestUrl = req.url || "/";

    // Keep query strings intact while matching only the pathname.
    const [pathname, query = ""] = requestUrl.split("?");
    if (SEO_ROUTE_PATTERN.test(pathname)) {
        const normalizedPath = pathname.endsWith("/") ? pathname : `${pathname}/`;
        req.url = `${normalizedPath}index.html${query ? `?${query}` : ""}`;
    } else {
        for (const [pattern, rewritePath] of STATIC_INDEX_ROUTES) {
            if (!pattern.test(pathname)) continue;

            req.url = `${rewritePath}${query ? `?${query}` : ""}`;
            break;
        }
    }

    next();
};

const seoStaticRoutesPlugin = {
    name: "seo-static-routes",
    configureServer(server) {
        server.middlewares.use(rewriteSeoRouteToStaticIndex);
    },
    configurePreviewServer(server) {
        server.middlewares.use(rewriteSeoRouteToStaticIndex);
    },
};

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), seoStaticRoutesPlugin],
    base: "/", // Custom domain rivercleanup.co.uk served from root
    build: {
        rollupOptions: {
            input: {
                main: fileURLToPath(new URL("./index.html", import.meta.url)),
                links: fileURLToPath(new URL("./links/index.html", import.meta.url)),
            },
        },
    },
});
