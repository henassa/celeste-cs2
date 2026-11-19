// Vérifie qu'une app empaquetée peut lancer les scripts d'extraction : chaque module importé par
// scripts/ doit se charger depuis le dossier de l'app (electron-builder écarte certains fichiers).
//   ELECTRON_RUN_AS_NODE=1 <app exe> scripts/check-package.mjs   (dans resources/app)

const MODULES = ['three', 'three/examples/jsm/loaders/GLTFLoader.js', 'pngjs', 'meshoptimizer'];
let failed = 0;
for (const m of MODULES) {
  try { await import(m); console.log(`ok ${m}`); } catch (e) { failed++; console.error(`MISSING ${m}: ${e instanceof Error ? e.message : e}`); }
}
process.exit(failed ? 1 : 0);
