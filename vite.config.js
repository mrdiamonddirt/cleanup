import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SEO_ROUTE_PATTERN = /^\/(poi|share)\/[^/]+\/$/;

const rewriteSeoRouteToStaticIndex = (req, _res, next) => {
    const requestUrl = req.url || "/";

    // Keep query strings intact while matching only the pathname.
    const [pathname, query = ""] = requestUrl.split("?");
    if (SEO_ROUTE_PATTERN.test(pathname)) {
        req.url = `${pathname}index.html${query ? `?${query}` : ""}`;
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
});
