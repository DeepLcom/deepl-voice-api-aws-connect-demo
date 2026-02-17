import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  server: {
    https: true,
    fs: {
      cachedChecks: false,
    },
  }, // Not needed for Vite 5+
  plugins: [
    mkcert(),
    nodePolyfills(),
    viteStaticCopy({
      targets: [
        {
          src: "lib/*",
          dest: "./lib",
        },
        {
          src: "assets/*",
          dest: "./assets",
        },
      ],
    }),
  ],
  define: {
    // By default, Vite doesn't include shims for NodeJS/
    // necessary for segment analytics lib to work
    global: {},
  },
});
