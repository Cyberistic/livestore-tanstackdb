
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { livestoreDevtoolsPlugin } from '@livestore/devtools-vite'
import viteReact from "@vitejs/plugin-react";
import alchemy from "alchemy/cloudflare/tanstack-start";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "esnext",
    rollupOptions: {
      external: ["node:async_hooks", "cloudflare:workers"],
    },
  },
  plugins: [
    alchemy(),
    tanstackStart(),
    viteReact(),
    livestoreDevtoolsPlugin({ schemaPath: './src/livestore/schema.ts' })
  ],
});