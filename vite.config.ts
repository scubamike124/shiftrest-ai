import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { nitro } from 'nitro/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({mode, command}) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  const buildId = `b-${Date.now()}`;
  return {
    define: { __BUILD_ID__: JSON.stringify(buildId) },
    resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-router'] },
    plugins: [
      tailwindcss(), tsconfigPaths(),
      tanstackStart({server:{entry:'server'}, importProtection:{behavior:'error',client:{files:['**/server/**'],specifiers:['server-only']}}}),
      ...(command === 'build' ? [nitro({preset:'node-server'})] : []),
      react(),
      VitePWA({
        strategies:'injectManifest', srcDir:'public', filename:'sw-src.ts',
        injectRegister:null, registerType:'autoUpdate', devOptions:{enabled:false},
        // Nitro assembles assets after Vite's worker build; inject the complete
        // manifest in finalize-node-build.mjs, once .output/public exists.
        injectManifest:{injectionPoint:undefined},
        manifest:false,
      }),
    ],
  };
});
