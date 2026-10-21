/**
 * Déconnexion : les jetons sont révoqués côté serveur (POST /auth/logout,
 * lot 1.12) avant l'effacement local, et l'utilisateur est déconnecté quelle
 * que soit l'issue de la requête. `fetch` est simulé.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokens } from "../api";
import { AuthProvider, useAuth } from "./AuthContext";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const fetchSimule = vi.fn<typeof fetch>();

function json(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Une requête qui ne répond jamais, mais obéit à l'annulation. */
function sansReponse(init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("annulée", "AbortError")),
    );
  });
}

const UTILISATEUR = { id: "u1", email: "awa@example.com", full_name: "Awa Test", role: "tenant" };

interface AppelLogout {
  autorisation: string | undefined;
  /** Contenu du stockage local au moment où la requête part. */
  stockage: { access: string | null; refresh: string | null };
  init: RequestInit | undefined;
}

let appelsLogout: AppelLogout[] = [];
let reponsesLogout: Array<(init?: RequestInit) => Promise<Response>> = [];
let urlsAppelees: string[] = [];

type ValeurAuth = ReturnType<typeof useAuth>;
let ctx: ValeurAuth;
/** Transmet la valeur du contexte au test à chaque rendu. */
function Sonde({ surRendu }: { surRendu: (valeur: ValeurAuth) => void }) {
  surRendu(useAuth());
  return null;
}

let racine: ReturnType<typeof createRoot> | null = null;

/** Laisse s'écouler les promesses et les minuteries de `ms` millisecondes. */
async function attendre(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function monter() {
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine!.render(
      <AuthProvider>
        <Sonde surRendu={(valeur) => (ctx = valeur)} />
      </AuthProvider>,
    );
  });
  await attendre();
}

/** Session ouverte : jetons en stockage, /auth/me a répondu. */
async function connecte() {
  tokens.set("acces-valide", "refresh-valide");
  await monter();
  expect(ctx.user?.id).toBe("u1");
}

function deconnecter() {
  act(() => ctx.deconnecter());
}

function sessionLocaleEffacee() {
  expect(tokens.access()).toBeNull();
  expect(tokens.refresh()).toBeNull();
  expect(ctx.user).toBeNull();
  expect(ctx.estConnecte).toBe(false);
  expect(ctx.erreurSession).toBeNull();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchSimule);
  localStorage.clear();
  sessionStorage.clear();
  appelsLogout = [];
  reponsesLogout = [];
  urlsAppelees = [];
  fetchSimule.mockReset();
  fetchSimule.mockImplementation(async (url, init) => {
    const chemin = String(url);
    urlsAppelees.push(chemin);
    if (chemin.endsWith("/auth/me")) return json(UTILISATEUR);
    if (chemin.endsWith("/auth/logout")) {
      appelsLogout.push({
        autorisation: (init?.headers as Record<string, string> | undefined)?.Authorization,
        stockage: { access: tokens.access(), refresh: tokens.refresh() },
        init,
      });
      const repondre = reponsesLogout.shift() ?? (() => Promise.resolve(json({ message: "Déconnexion réussie" })));
      return repondre(init);
    }
    if (chemin.endsWith("/auth/refresh")) return json({ access_token: "acces-ressuscite" });
    throw new Error(`Appel inattendu : ${chemin}`);
  });
});

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Aucun rafraîchissement, aucune déconnexion forcée (motif, redirection). */
function niRafraichissementNiRedirection(page: string) {
  expect(urlsAppelees.some((url) => url.endsWith("/auth/refresh"))).toBe(false);
  expect(sessionStorage.length).toBe(0);
  expect(window.location.pathname).toBe(page);
}

describe("déconnexion", () => {
  it("révoque les jetons avec le jeton d'accès, avant l'effacement local", async () => {
    await connecte();

    deconnecter();
    await attendre();

    expect(appelsLogout).toHaveLength(1);
    const [appel] = appelsLogout;
    expect(appel.autorisation).toBe("Bearer acces-valide");
    expect(appel.init?.method).toBe("POST");
    // La requête est partie alors que les jetons étaient encore stockés.
    expect(appel.stockage).toEqual({ access: "acces-valide", refresh: "refresh-valide" });
    sessionLocaleEffacee();
  });

  it("déconnecte localement sans attendre la réponse du serveur", async () => {
    await connecte();
    reponsesLogout.push(sansReponse);

    deconnecter();

    expect(appelsLogout).toHaveLength(1);
    sessionLocaleEffacee();
  });

  it("abandonne la requête après 5 s sans réponse, sans autre essai", async () => {
    await connecte();
    reponsesLogout.push(sansReponse);

    deconnecter();
    const signal = appelsLogout[0].init?.signal;
    await attendre(4_999);
    expect(signal?.aborted).toBe(false);
    await attendre(1);
    expect(signal?.aborted).toBe(true);

    await attendre(60_000);
    expect(appelsLogout).toHaveLength(1);
    sessionLocaleEffacee();
  });

  it.each([
    ["une coupure réseau", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["un 404 (backend antérieur au lot 1.12)", () => Promise.resolve(json({ error: "Introuvable" }, 404))],
    ["un 500", () => Promise.resolve(json({ error: "Erreur interne" }, 500))],
    ["un 503 (serveur endormi)", () => Promise.resolve(new Response("<html>", { status: 503 }))],
  ])("déconnecte localement malgré %s, sans message ni nouvel essai", async (_cas, reponse) => {
    window.history.replaceState({}, "", "/tenant/profile");
    await connecte();
    reponsesLogout.push(reponse);

    deconnecter();
    await attendre(60_000);

    expect(appelsLogout).toHaveLength(1);
    sessionLocaleEffacee();
    niRafraichissementNiRedirection("/tenant/profile");
  });

  it("jeton d'accès refusé (401) : un seul essai de plus, avec le jeton de rafraîchissement", async () => {
    window.history.replaceState({}, "", "/tenant/profile");
    await connecte();
    reponsesLogout.push(() => Promise.resolve(json({ error: "Jeton expiré" }, 401)));

    deconnecter();
    await attendre();

    expect(appelsLogout.map((appel) => appel.autorisation)).toEqual([
      "Bearer acces-valide",
      "Bearer refresh-valide",
    ]);
    sessionLocaleEffacee();
    niRafraichissementNiRedirection("/tenant/profile");
  });

  it("jetons déjà révoqués (401 deux fois) : déconnexion locale, sans boucle", async () => {
    window.history.replaceState({}, "", "/owner/profile");
    await connecte();
    const refus = () => Promise.resolve(json({ error: "Session révoquée" }, 401));
    reponsesLogout.push(refus, refus);

    deconnecter();
    await attendre(60_000);

    expect(appelsLogout).toHaveLength(2);
    sessionLocaleEffacee();
    niRafraichissementNiRedirection("/owner/profile");
    // Aucun jeton réécrit après coup (rafraîchissement tardif).
    expect(tokens.access()).toBeNull();
  });

  it("sans jeton d'accès, envoie le jeton de rafraîchissement", async () => {
    localStorage.setItem("tcheyna_refresh_token", "refresh-seul");
    await monter();

    deconnecter();
    await attendre();

    expect(appelsLogout.map((appel) => appel.autorisation)).toEqual(["Bearer refresh-seul"]);
    sessionLocaleEffacee();
  });

  it("sans aucun jeton, n'appelle pas le serveur", async () => {
    await monter();

    deconnecter();
    await attendre(60_000);

    expect(fetchSimule).not.toHaveBeenCalled();
    sessionLocaleEffacee();
  });
});
