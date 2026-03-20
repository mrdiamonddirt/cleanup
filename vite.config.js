import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            "/api/lancaster-tides": {
                target: "https://www.tide-forecast.com",
                changeOrigin: true,
                rewrite: () => "/locations/Lancaster/tides/latest",
            },
        },
    },
    base: "./", // Use relative paths so it works on any GH Pages URL
});
