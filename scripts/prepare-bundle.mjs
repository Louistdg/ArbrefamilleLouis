import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {patchApp, report} from './patch-app.mjs';
import {exclureMineurs} from './exclure-mineurs.mjs';
import {masquerVivants} from './masquer-vivants.mjs';
import {injecterDonnees} from './injecter-donnees.mjs';

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

// Les donnees fusionnees du dernier export GEDCOM remplacent celles du fichier.
// Le HTML n'est pas versionne : c'est ici que passe la mise a jour de l'arbre.
// --garder-donnees garde les donnees telles qu'elles sont dans le fichier.
if (!flags.has('--garder-donnees') && existsSync('donnees/famille.json')) {
  const donnees = JSON.parse(readFileSync('donnees/famille.json', 'utf8'));
  html = injecterDonnees(html, donnees);
  const ajout = donnees.meta.integratedFrom || {};
  console.log('Donnees fusionnees appliquees : ' + donnees.people.length + ' personnes, '
    + donnees.families.length + ' familles, ' + donnees.sources.length + ' sources');
  if (ajout.personnesAjoutees) {
    console.log('  apport de l\'export : +' + ajout.personnesAjoutees + ' personnes, +'
      + ajout.famillesAjoutees + ' familles, +' + ajout.sourcesAjoutees + ' sources');
  }
}

// Le fichier publie ne doit pas exposer d'enfant : nom, date et lieu de
// naissance d'une personne mineure ne sont pas destines a une page publique.
// --garder-mineurs desactive ce retrait.
{
  const r = exclureMineurs(html, {actif: !flags.has('--garder-mineurs')});
  if (r.erreur) {
    console.error('ECHEC : ' + r.erreur);
    process.exit(1);
  }
  if (r.modifie) {
    console.log('Personnes mineures retirees du fichier publie :');
    r.exclus.forEach(p => console.log('  - ' + p.nom + ' (' + (p.naissance || 'date inconnue') + ')'));
    console.log('  personnes publiees : ' + r.personnes);
    html = r.html;
  } else if (!flags.has('--garder-mineurs')) {
    console.log('Aucune personne mineure a retirer.');
  }
}

// Les personnes vivantes gardent leur annee de naissance, mais perdent la date
// exacte et le lieu : c'est le couple le plus identifiant du fichier.
// --garder-vivants desactive ce masquage.
{
  const r = masquerVivants(html, {actif: !flags.has('--garder-vivants')});
  if (r.erreur) {
    console.error('ECHEC : ' + r.erreur);
    process.exit(1);
  }
  if (r.modifie) {
    console.log('Personnes vivantes : date exacte et lieu retires (' + r.masques.length + ')');
    r.masques.slice(0, 40).forEach(p => console.log('  - ' + p.nom));
    if (r.masques.length > 40) console.log('  ... et ' + (r.masques.length - 40) + ' autre(s)');
    html = r.html;
  } else if (!flags.has('--garder-vivants')) {
    console.log('Aucune personne vivante a masquer.');
  }
}

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
