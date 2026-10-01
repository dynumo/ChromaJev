// Bundles the browser code (src/client) into public/assets/app.js.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/client/app.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2022'],
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production',
  outfile: 'public/assets/app.js',
  logLevel: 'info',
});
