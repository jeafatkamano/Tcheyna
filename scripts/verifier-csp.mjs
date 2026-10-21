#!/usr/bin/env node
/**
 * verifier-csp.mjs — Confronte le build du site (frontend/dist) à la
 * Content-Security-Policy déclarée dans render.yaml (lot 1.17).
 *
 * Usage (après `npm run build`, depuis la racine du dépôt ou ailleurs) :
 *   node scripts/verifier-csp.mjs [dossier_dist]
 *
 * Échoue (code 1) si :
 *   • un <script> inline, un <style> ou un attribut on…= / style= d'une page
 *     HTML du build n'a pas son empreinte sha256 dans la directive voulue ;
 *   • la CSP contient 'unsafe-inline' ou 'unsafe-eval' ;
 *   • l'origine de VITE_API_URL manque à connect-src ou à img-src.
 * Le message donne l'empreinte à recopier dans render.yaml.
 *
 * Sans dépendance : render.yaml est lu par un analyseur minimal, limité à la
 * forme qu'y prennent les en-têtes (`- path:` / `name:` / `value:`, valeur
 * sur une ligne ou repliée par `>-`). Une forme inattendue arrête le script
 * plutôt que de laisser passer une CSP mal lue.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sansGuillemets(texte) {
  const t = texte.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

const indentation = (ligne) => ligne.length - ligne.trimStart().length;
const ignorable = (ligne) => ligne.trim() === "" || ligne.trim().startsWith("#");

/**
 * En-têtes du site statique et URL de l'API, lus dans render.yaml.
 * @returns {{ entetes: {path: string, name: string, value: string}[], apiUrl: string }}
 */
export function lireRenderYaml(fichier = path.join(RACINE, "render.yaml")) {
  const lignes = readFileSync(fichier, "utf8").replace(/\r\n/g, "\n").split("\n");

  const iApi = lignes.findIndex((l) => /^\s*- key: VITE_API_URL\s*$/.test(l));
  const valeurApi = iApi >= 0 && /^\s*value:\s*(\S.*)$/.exec(lignes[iApi + 1] ?? "");
  if (!valeurApi) throw new Error("render.yaml : VITE_API_URL introuvable (ou sans `value:` juste après).");
  const apiUrl = sansGuillemets(valeurApi[1]);

  const iEntetes = lignes.findIndex((l) => /^\s*headers:\s*$/.test(l));
  if (iEntetes < 0) throw new Error("render.yaml : section `headers:` introuvable.");
  const niveau = indentation(lignes[iEntetes]);

  const entetes = [];
  let courant = null;
  for (let i = iEntetes + 1; i < lignes.length; i++) {
    const ligne = lignes[i];
    if (ignorable(ligne)) continue;
    if (indentation(ligne) <= niveau) break;

    const m = /^\s*(- )?(path|name|value):\s*(.*)$/.exec(ligne);
    if (!m) throw new Error(`render.yaml, ligne ${i + 1} : forme d'en-tête non reconnue.`);
    if (m[1]) {
      courant = {};
      entetes.push(courant);
    }
    if (!courant) throw new Error(`render.yaml, ligne ${i + 1} : clé hors d'une entrée \`- path:\`.`);

    let valeur = m[3];
    if (valeur === ">-") {
      // Scalaire replié : lignes plus indentées, jointes par une espace.
      const morceaux = [];
      const base = indentation(ligne);
      while (i + 1 < lignes.length && lignes[i + 1].trim() !== "" && indentation(lignes[i + 1]) > base) {
        morceaux.push(lignes[++i].trim());
      }
      valeur = morceaux.join(" ");
    } else if (/^[>|]/.test(valeur)) {
      throw new Error(`render.yaml, ligne ${i + 1} : seul le style replié \`>-\` est pris en charge.`);
    }
    courant[m[2]] = sansGuillemets(valeur);
  }

  for (const e of entetes) {
    if (!e.path || !e.name || e.value === undefined) {
      throw new Error(`render.yaml : en-tête incomplet ${JSON.stringify(e)}.`);
    }
  }
  return { entetes, apiUrl };
}

/** Directives de la CSP : { "script-src": ["'self'", …], … }. */
export function analyserCsp(csp) {
  const directives = {};
  for (const morceau of csp.split(";")) {
    const [nom, ...sources] = morceau.trim().split(/\s+/);
    if (nom) directives[nom.toLowerCase()] = sources;
  }
  return directives;
}

const empreinte = (texte) => `'sha256-${createHash("sha256").update(texte, "utf8").digest("base64")}'`;

function pagesHtml(dossier) {
  const pages = [];
  for (const nom of readdirSync(dossier)) {
    const chemin = path.join(dossier, nom);
    if (statSync(chemin).isDirectory()) pages.push(...pagesHtml(chemin));
    else if (nom.endsWith(".html")) pages.push(chemin);
  }
  return pages;
}

/**
 * Contenus inline d'une page, avec la directive qui doit les autoriser.
 * Render construit depuis un clone Linux (fins de ligne LF) : un CRLF dû à
 * `core.autocrlf` sous Windows est ramené à LF pour calculer l'empreinte
 * qu'aura la page en production.
 */
function contenusInline(html) {
  const texte = html.replace(/\r\n/g, "\n");
  const trouves = [];
  for (const m of texte.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/.test(m[1])) trouves.push({ directive: "script-src", texte: m[2], quoi: "<script> inline" });
  }
  for (const m of texte.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    trouves.push({ directive: "style-src", texte: m[1], quoi: "<style>" });
  }
  for (const m of texte.matchAll(/<[a-z][^>]*>/gi)) {
    for (const a of m[0].matchAll(/\s(on[a-z]+|style)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      const nom = a[1].toLowerCase();
      trouves.push({
        directive: nom === "style" ? "style-src" : "script-src",
        texte: a[3] ?? a[4],
        quoi: `attribut ${nom}=`,
        attribut: true,
      });
    }
  }
  return trouves;
}

function verifier(dossierDist) {
  const { entetes, apiUrl } = lireRenderYaml();
  const ligneCsp = entetes.find((e) => e.path === "/*" && e.name.toLowerCase() === "content-security-policy");
  if (!ligneCsp) return ["render.yaml : aucune Content-Security-Policy sur /*."];

  const csp = analyserCsp(ligneCsp.value);
  const sources = (d) => csp[d] ?? csp["default-src"] ?? [];
  const erreurs = [];

  for (const [d, valeurs] of Object.entries(csp)) {
    for (const interdit of ["'unsafe-inline'", "'unsafe-eval'"]) {
      if (valeurs.includes(interdit)) erreurs.push(`${d} contient ${interdit}.`);
    }
  }

  const api = new URL(apiUrl).origin;
  for (const d of ["connect-src", "img-src"]) {
    if (!sources(d).includes(api)) erreurs.push(`${d} ne contient pas l'origine de l'API (${api}).`);
  }

  for (const page of pagesHtml(dossierDist)) {
    const relatif = path.relative(dossierDist, page);
    for (const c of contenusInline(readFileSync(page, "utf8"))) {
      const hash = empreinte(c.texte);
      if (!sources(c.directive).includes(hash)) {
        const aussi = c.attribut ? " (avec 'unsafe-hashes')" : "";
        erreurs.push(`${relatif} : ${c.quoi} non autorisé — ajouter ${hash} à ${c.directive}${aussi}.`);
      } else if (c.attribut && !sources(c.directive).includes("'unsafe-hashes'")) {
        erreurs.push(`${relatif} : ${c.quoi} exige 'unsafe-hashes' dans ${c.directive}.`);
      }
    }
  }
  return erreurs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dossier = path.resolve(process.argv[2] ?? path.join(RACINE, "frontend", "dist"));
  try {
    statSync(dossier);
  } catch {
    console.error(`Dossier introuvable : ${dossier} (lancer d'abord npm run build).`);
    process.exit(1);
  }
  const erreurs = verifier(dossier);
  if (erreurs.length) {
    console.error("CSP de render.yaml incompatible avec le build :");
    for (const e of erreurs) console.error(`  • ${e}`);
    process.exit(1);
  }
  console.log(`CSP de render.yaml conforme au build (${dossier}).`);
}
