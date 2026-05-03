import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/go-api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/go-api/, ""),
      },
      "/restful-api": {
        target: "http://localhost:8898",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/restful-api/, ""),
      },
      "/ai-api": {
        target: "http://localhost:8899",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ai-api/, ""),
      },
    },
  },
});
