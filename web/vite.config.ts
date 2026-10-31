import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Local dev: proxy API calls to the Express server running on port 3000.
    // On Vercel, the top-level rewrites in vercel.json handle this instead.
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/media": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
    },
  },
});
