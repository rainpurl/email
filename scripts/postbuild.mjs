// Ensures dist/.assetsignore exists after the build so Cloudflare does not try
// to upload the _worker.js directory as a public static asset. This runs
// automatically via the npm "postbuild" hook after `npm run build`, so it works
// even if the committed public/.assetsignore was dropped during a web upload.
import { writeFileSync, existsSync } from 'node:fs';

const dir = 'dist';
if (!existsSync(dir)) {
  console.error('[postbuild] dist/ not found. Did astro build run?');
  process.exit(1);
}
writeFileSync(`${dir}/.assetsignore`, '_worker.js\n_routes.json\n');
console.log('[postbuild] wrote dist/.assetsignore');
