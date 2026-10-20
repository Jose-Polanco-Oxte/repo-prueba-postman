import { mkdir, writeFile } from 'node:fs/promises';
import { buildApp } from '../src/app.js';

const app = await buildApp();
try {
  await mkdir(new URL('../docs/', import.meta.url), { recursive: true });
  await writeFile(new URL('../docs/openapi.json', import.meta.url), JSON.stringify(app.swagger(), null, 2) + '\n');
  console.log('OpenAPI generado en docs/openapi.json');
} finally {
  await app.close();
}
