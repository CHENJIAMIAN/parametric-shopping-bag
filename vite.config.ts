import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_REPOSITORY ? `/${process.env.GITHUB_REPOSITORY.split("/")[1]}/` : "/",
  server: {
    port: 5178,
    strictPort: false
  },
  preview: {
    port: 4178,
    strictPort: false
  }
});
