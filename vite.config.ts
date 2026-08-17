import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Read the Supabase connection from the environment (a local .env file or the
  // host's build-time env vars) rather than hardcoding a single project. This is
  // what lets the frontend point at whichever Supabase project you deploy to.
  const env = loadEnv(mode, process.cwd(), "");
  const SUPABASE_URL = env.VITE_SUPABASE_URL ?? "";
  const SUPABASE_PROJECT_ID = env.VITE_SUPABASE_PROJECT_ID ?? "";
  const SUPABASE_ANON_KEY =
    env.VITE_SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

  return {
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/tally-local": {
        target: "http://localhost:9000",
        changeOrigin: false,
        rewrite: () => "/",
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger(), mcpPlugin()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The Tally serializer is shared verbatim with the edge functions and the
      // desktop agent. It lives under supabase/functions/_shared so Deno can
      // import it without a build step; this alias lets the web app in too.
      "@tally": path.resolve(__dirname, "./supabase/functions/_shared/tally"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(SUPABASE_URL),
    'import.meta.env.VITE_SUPABASE_PROJECT_ID': JSON.stringify(SUPABASE_PROJECT_ID),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(SUPABASE_ANON_KEY),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(SUPABASE_ANON_KEY),
  },
  };
});
