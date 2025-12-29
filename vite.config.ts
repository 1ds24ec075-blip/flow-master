import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '"https://pskuxhpfohmxlhmupeoz.supabase.co"',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBza3V4aHBmb2hteGxobXVwZW96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1NzgxMjksImV4cCI6MjA4MDE1NDEyOX0.3ptldlb9sGXhYllFAe__Y73B51S-amUOeYIksXpDlx8"',
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBza3V4aHBmb2hteGxobXVwZW96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ1NzgxMjksImV4cCI6MjA4MDE1NDEyOX0.3ptldlb9sGXhYllFAe__Y73B51S-amUOeYIksXpDlx8"',
  },
}));
