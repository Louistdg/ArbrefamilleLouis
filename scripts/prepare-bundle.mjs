import {readFileSync, writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';

// Produit localement les variables APP_CHUNK_* attendues par la fonction Railway.
// Ne pas ajouter au dépôt Git le fichier .env.railway généré.
const input = process.argv[2] || 'index.html';
const output = process.argv[3] || '.env.railway';
const html = readFileSync(input);
const encoded = gzipSync(html, {level: 9}).toString('base64');
const count = Math.max(1, Math.ceil(encoded.length / 19000));
const step = Math.ceil(encoded.length / count / 4) * 4;
const chunks = [];
for (let i = 0; i < count; i++) {
  const value = encoded.slice(i * step, (i + 1) * step);
  if (value) chunks.push(value);
}
const lines = ['APP_CHUNK_COUNT=' + chunks.length];
chunks.forEach((part, i) => lines.push('APP_CHUNK_' + i + '=' + part));
writeFileSync(output, lines.join('\n') + '\n', {encoding:'utf8',mode:0o600});
console.log('Variables du HTML générées : ' + chunks.length + ' parties, fichier ' + output);
