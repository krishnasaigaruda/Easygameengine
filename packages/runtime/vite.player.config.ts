import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const mod = (path: string) => fileURLToPath(new URL(`../../node_modules/${path}`, import.meta.url));

/** The licences of what's inside ege-player.js, written next to it (exports include this file). */
function thirdPartyNotices(): Plugin {
  return {
    name: 'ege-third-party-notices',
    generateBundle() {
      const part = (name: string, url: string, license: string, file: string) =>
        `${name} (${url})\nLicense: ${license}\n\n${readFileSync(mod(file), 'utf8').trim()}\n`;
      const text = [
        'Easy Game Engine player (ege-player.js) includes the following open-source software.\n',
        part('three.js', 'https://threejs.org', 'MIT', 'three/LICENSE'),
        part('Rapier physics (@dimforge/rapier3d-compat)', 'https://rapier.rs', 'Apache-2.0', '@dimforge/rapier3d-compat/LICENSE'),
      ].join('\n----------------------------------------------------------------------\n\n');
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: text });
    },
  };
}

/** ege-player.js: the engine on its own, as one file, for exported games. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  plugins: [thirdPartyNotices()],
  build: {
    target: 'es2022',
    outDir: fileURLToPath(new URL('../editor/public/runtime', import.meta.url)),
    emptyOutDir: true,
    lib: { entry: 'src/player/exportEntry.ts', formats: ['es'], fileName: () => 'ege-player.js' },
    minify: true,
    rollupOptions: {
      output: {
        codeSplitting: false,
        minify: true,
        postBanner: '/*! Easy Game Engine player. Includes three.js (MIT) and Rapier (Apache-2.0): see THIRD-PARTY-NOTICES.txt */',
      },
    },
  },
});
