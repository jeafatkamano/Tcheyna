#!/usr/bin/env node
/**
 * servir-dist.mjs — Sert frontend/dist en local comme le site statique
 * Render : mêmes en-têtes que render.yaml (CSP comprise) et même réécriture
 * monopage (toute route sans fichier reçoit index.html). Sert à vérifier
 * dans un vrai navigateur qu'aucune page n'enfreint la CSP (lot 1.17).
 *
 * Usage :
 *   node scripts/servir-dist.mjs [--port 4173] [--dist frontend/dist] [--api http://localhost:5000]
 *                                [--render render.yaml]
 *
 * --api remplace l'origine de production de l'API (VITE_API_URL de
 * render.yaml) par une API locale dans la CSP servie, rien d'autre : le build
 * doit alors avoir été fait avec VITE_API_URL=<cette origine>/api.
 * Sans dépendance ; à ne pas utiliser en production.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { lireRenderYaml } from "./verifier-csp.mjs";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function option(nom, defaut) {
  const i = process.argv.indexOf(`--${nom}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
}

const port = Number(option("port", "4173"));
const dist = path.resolve(option("dist", path.join(RACINE, "frontend", "dist")));
const apiLocale = option("api", null);

const { entetes, apiUrl } = lireRenderYaml(option("render", undefined));
const apiProd = new URL(apiUrl).origin;
const regles = entetes.map((e) => ({
  ...e,
  value: apiLocale ? e.value.split(apiProd).join(new URL(apiLocale).origin) : e.value,
}));

/** Chemins Render : `/*` = tout, `/x/*` = sous /x/, sinon chemin exact. */
function correspond(motif, chemin) {
  if (motif === "/*") return true;
  if (motif.endsWith("/*")) return chemin.startsWith(motif.slice(0, -1));
  return motif === chemin;
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function fichier(chemin) {
  const cible = path.join(dist, path.normalize(chemin).replace(/^([/\\])+/, ""));
  if (!cible.startsWith(dist)) return null;
  try {
    return statSync(cible).isFile() ? cible : null;
  } catch {
    return null;
  }
}

createServer((req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, "http://local").pathname);
  // Réécriture monopage de render.yaml : /* → /index.html si aucun fichier.
  const cible = fichier(chemin) ?? fichier("/index.html");
  for (const r of regles) {
    if (correspond(r.path, chemin)) res.setHeader(r.name, r.value);
  }
  res.setHeader("Content-Type", TYPES[path.extname(cible)] ?? "application/octet-stream");
  createReadStream(cible).pipe(res);
}).listen(port, () => {
  console.log(`frontend/dist servi sur http://localhost:${port}`);
  if (apiLocale) console.log(`CSP : ${apiProd} remplacée par ${new URL(apiLocale).origin}`);
});
