import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const distDir = resolve(scriptDir, '..', 'dist');
const indexPath = resolve(distDir, 'index.html');

const PLACEHOLDER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Voice Overlay Assistant</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

await mkdir(distDir, { recursive: true });

try {
  await access(indexPath);
} catch {
  await writeFile(indexPath, PLACEHOLDER_HTML, 'utf8');
}
