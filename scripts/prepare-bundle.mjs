import {readFileSync, writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {patchApp, report} from './patch-app.mjs';

// Produit localement les variables APP_CHUNK_* attendues par la fonction Railway.
// Ne pas ajouter au dépôt Git le fichier .env.railway généré.
//
// Les correctifs d'audit de l'application sont appliques ici : le HTML n'est pas
// versionne (donnees personnelles), donc c'est le seul point ou ils peuvent vivre.
// Si un correctif ne s'applique plus, le script s'arrete : mieux vaut un build
// rouge qu'un deploiement silencieusement non corrige.
//
// Usage :
//   node scripts/prepare-bundle.mjs [entree] [sortie]
//   node scripts/prepare-bundle.mjs index.html .env.railway --no-patch
//   node scripts/prepare-bundle.mjs index.html .env.railway --allow-partial

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const positional = args.filter(a => !a.startsWith('--'));

const input = positional[0] || 'index.html';
const output = positional[1] || '.env.railway';

let html = readFileSync(input, 'utf8');

if (!flags.has('--no-patch')) {
  const result = patchApp(html);
  console.log('Correctifs d\'audit — ' + input);
  console.log(report(result));
  if (result.broken.length) {
    console.error('ECHEC : correctif(s) non verifiable(s) : ' + result.broken.join(', '));
    process.exit(1);
  }
  if (result.missing.length && !flags.has('--allow-partial')) {
    console.error('\nECHEC : ' + result.missing.length + ' correctif(s) ne s\'appliquent plus sur ' + input + '.');
    console.error('Reportez les correctifs dans la source privee, puis mettez a jour les ancrages');
    console.error('de scripts/patch-app.mjs. Utilisez --allow-partial pour deployer malgre tout.');
    process.exit(1);
  }
  html = result.html;
} else {
  console.log('Correctifs d\'audit ignores (--no-patch).');
}

const encoded = gzipSync(Buffer.from(html, 'utf8'), {level: 9}).toString('base64');
const count = Math.max(1, Math.ceil(encoded.length / 19000));
const step = Math.ceil(encoded.length / count / 4) * 4;
const chunks = [];
for (let i = 0; i < count; i++) {
  const value = encoded.slice(i * step, (i + 1) * step);
  if (value) chunks.push(value);
}
const lines = ['APP_CHUNK_COUNT=' + chunks.length];
chunks.forEach((part, i) => lines.push('APP_CHUNK_' + i + '=' + part));
writeFileSync(output, lines.join('\n') + '\n', {encoding:'utf8', mode:0o600});
console.log('Variables du HTML générées : ' + chunks.length + ' parties, fichier ' + output
  + ' (' + encoded.length + ' octets base64 pour ' + Buffer.byteLength(html, 'utf8') + ' octets de HTML)');
