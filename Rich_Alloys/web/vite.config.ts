import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// base "./" lets the build be served from any sub-path of the site.
export default defineConfig({ plugins: [react()], base: "./" });
