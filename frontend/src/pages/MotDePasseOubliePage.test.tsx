/**
 * Connexion par téléphone et mot de passe oublié par SMS (lot 3.8).
 *
 * `fetch` est simulé : le vrai client d'API tourne, avec ses statuts et le
 * corps d'erreur commun du serveur (`error`, `details`, `reessayer_dans`).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tokens } from "../api";
import { AuthProvider } from "../context/AuthContext";
import { LoginPage } from "./LoginPage";
import { MotDePasseOubliePage } from "./MotDePasseOubliePage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MESSAGE_NEUTRE =
  "Si ce numéro correspond à un compte dont le téléphone est vérifié, un code vient d'être envoyé par SMS.";
const MESSAGE_SUCCES = "Mot de passe modifié. Vous avez été déconnecté de tous vos appareils.";

const UTILISATEUR = {
  id: "u1",
  email: "awa@exemple.gn",
  full_name: "Awa Camara",
  role: "tenant",
  phone: "+224622529252",
  phone_verified: true,
};

type Reponse = { status?: number; corps: unknown };

/** Réponses simulées par route (`POST /auth/login`…) ; chaque appel est noté. */
let reponses: Record<string, Reponse | Reponse[]> = {};
const appels: { route: string; corps: unknown; init?: RequestInit }[] = [];

const fetchSimule = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const chemin = String(url).replace(/^.*\/api/, "");
  const route = `${(init?.method ?? "GET").toUpperCase()} ${chemin}`;
  appels.push({ route, corps: init?.body ? JSON.parse(String(init.body)) : undefined, init });
  const prevue = reponses[route];
  const reponse = Array.isArray(prevue) ? prevue.shift() : prevue;
  if (!reponse) return new Response(JSON.stringify({ error: "Introuvable" }), { status: 404 });
  return new Response(JSON.stringify(reponse.corps), {
    status: reponse.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
});

function appelsVers(route: string) {
  return appels.filter((a) => a.route === route);
}

let racine: ReturnType<typeof createRoot> | null = null;
let conteneur: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchSimule);
  fetchSimule.mockClear();
  appels.length = 0;
  reponses = {};
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Laisse aboutir les requêtes simulées et les rendus qui en découlent. */
async function laisserFiler(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function afficher(chemin: string, etat?: unknown) {
  const router = createMemoryRouter(
    [
      { path: "/login", Component: LoginPage },
      { path: "/mot-de-passe-oublie", Component: MotDePasseOubliePage },
      { path: "/tenant/dashboard", element: <p>tableau de bord</p> },
    ],
    { initialEntries: [{ pathname: chemin, state: etat }] },
  );
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() =>
    racine!.render(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    ),
  );
  await laisserFiler();
  return router;
}

function champ(id: string) {
  const el = conteneur.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`champ #${id} absent`);
  return el;
}

/** Saisie dans un champ contrôlé par React. */
function saisir(id: string, valeur: string) {
  const el = champ(id);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, valeur);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function soumettre() {
  act(() => {
    conteneur
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await laisserFiler();
}

function bouton(texte: RegExp) {
  const el = [...conteneur.querySelectorAll("button")].find((b) => texte.test(b.textContent ?? ""));
  if (!el) throw new Error(`bouton ${texte} absent`);
  return el;
}

function alerte() {
  return conteneur.querySelector('[role="alert"]')?.textContent ?? null;
}

function annonce() {
  return conteneur.querySelector('[aria-live="polite"]')?.textContent ?? "";
}

/** Erreur liée au champ par `aria-describedby`. */
function erreurDuChamp(id: string) {
  const el = champ(id);
  const ids = (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  const erreur = ids.map((i) => document.getElementById(i)).find((n) => n?.id.endsWith("-erreur"));
  return { texte: erreur?.textContent ?? null, invalide: el.getAttribute("aria-invalid") === "true" };
}

async function passerALEtapeCode(numero = "622 52 92 52") {
  reponses["POST /auth/mot-de-passe-oublie"] = { corps: { message: MESSAGE_NEUTRE, expire_dans: 600 } };
  saisir("phone", numero);
  await soumettre();
}

function remplirEtapeCode(code = "123456", nouveau = "nouveau-secret", confirmation = nouveau) {
  saisir("code", code);
  saisir("nouveau-mdp", nouveau);
  saisir("confirmation-mdp", confirmation);
}

/* ─── Connexion ────────────────────────────────────────────── */

describe("LoginPage — connexion par e-mail ou téléphone", () => {
  it("envoie un numéro de téléphone dans le champ `email`, sans contrôle de format", async () => {
    reponses["POST /auth/login"] = {
      corps: { message: "Connexion réussie", user: UTILISATEUR, access_token: "a", refresh_token: "r" },
    };
    const router = await afficher("/login");

    const identifiant = champ("identifiant");
    expect(conteneur.querySelector('label[for="identifiant"]')!.textContent).toBe("E-mail ou téléphone");
    // `type="email"` bloquerait l'envoi d'un numéro dans un navigateur.
    expect(identifiant.type).toBe("text");
    expect(identifiant.inputMode).toBe("email");
    expect(identifiant.getAttribute("autocomplete")).toBe("username");

    saisir("identifiant", " 622 52 92 52 ");
    saisir("mdp", "mon-secret");
    await soumettre();

    const [connexion] = appelsVers("POST /auth/login");
    expect(connexion.corps).toEqual({ email: "622 52 92 52", password: "mon-secret" });
    expect(router.state.location.pathname).toBe("/tenant/dashboard");
  });

  it("affiche le 401 du serveur tel quel", async () => {
    reponses["POST /auth/login"] = { status: 401, corps: { error: "Identifiants incorrects" } };
    await afficher("/login");
    saisir("identifiant", "622529252");
    saisir("mdp", "faux");
    await soumettre();
    expect(alerte()).toBe("Identifiants incorrects");
  });

  it("propose le lien « Mot de passe oublié ? »", async () => {
    await afficher("/login");
    const lien = [...conteneur.querySelectorAll("a")].find((a) => a.textContent === "Mot de passe oublié ?");
    expect(lien?.getAttribute("href")).toBe("/mot-de-passe-oublie");
  });

  it("annonce la réinitialisation réussie et y place le focus", async () => {
    await afficher("/login", { reinitialise: true });
    const statut = conteneur.querySelector('[role="status"]')!;
    expect(statut.textContent).toBe(MESSAGE_SUCCES);
    expect(document.activeElement?.contains(statut)).toBe(true);
  });
});

/* ─── Mot de passe oublié ──────────────────────────────────── */

describe("MotDePasseOubliePage — parcours complet", () => {
  it("message neutre, compte à rebours, confirmation, retour à la connexion, session vidée", async () => {
    // Utilisateur connecté sur cet appareil.
    tokens.set("acces", "refresh");
    reponses["GET /auth/me"] = { corps: UTILISATEUR };
    const router = await afficher("/mot-de-passe-oublie");
    expect(conteneur.textContent).toContain("Seul un numéro vérifié permet de récupérer votre compte");

    await passerALEtapeCode(" 622 52 92 52 ");
    expect(appelsVers("POST /auth/mot-de-passe-oublie")[0].corps).toEqual({ phone: "622 52 92 52" });

    // Étape 2 : message du serveur tel quel, focus sur son titre.
    expect(conteneur.textContent).toContain(MESSAGE_NEUTRE);
    expect(document.activeElement?.textContent).toBe("Saisissez le code reçu");

    // Compte à rebours : visible à la seconde, annoncé au début et à la fin.
    const renvoi = bouton(/Renvoyer un code/);
    expect(renvoi.disabled).toBe(true);
    expect(renvoi.textContent).toBe("Renvoyer un code (dans 60 s)");
    expect(annonce()).toBe("Vous pourrez demander un nouveau code dans 60 s.");
    await laisserFiler(1000);
    expect(renvoi.textContent).toBe("Renvoyer un code (dans 59 s)");
    expect(annonce()).toBe("Vous pourrez demander un nouveau code dans 60 s.");
    await laisserFiler(59_000);
    expect(renvoi.disabled).toBe(false);
    expect(renvoi.textContent).toBe("Renvoyer un code");
    expect(annonce()).toBe("Vous pouvez demander un nouveau code.");

    reponses["POST /auth/mot-de-passe-oublie/confirmer"] = {
      corps: { message: "Mot de passe réinitialisé. Connectez-vous avec le nouveau mot de passe." },
    };
    remplirEtapeCode("123456", "nouveau-secret");
    await soumettre();

    expect(appelsVers("POST /auth/mot-de-passe-oublie/confirmer")[0].corps).toEqual({
      phone: "622 52 92 52",
      code: "123456",
      nouveau_mot_de_passe: "nouveau-secret",
    });
    expect(router.state.location.pathname).toBe("/login");
    expect(conteneur.querySelector('[role="status"]')!.textContent).toBe(MESSAGE_SUCCES);
    // Jetons révoqués par le serveur : la session locale est vidée.
    expect(tokens.access()).toBeNull();
    expect(tokens.refresh()).toBeNull();
  });

  it("redemande un code une fois le délai écoulé", async () => {
    await afficher("/mot-de-passe-oublie");
    await passerALEtapeCode();
    await laisserFiler(60_000);

    act(() => bouton(/Renvoyer un code/).click());
    await laisserFiler();

    expect(appelsVers("POST /auth/mot-de-passe-oublie")).toHaveLength(2);
    expect(bouton(/Renvoyer un code/).textContent).toBe("Renvoyer un code (dans 60 s)");
  });

  it("deux mots de passe différents : erreur sous la confirmation, sans appel", async () => {
    await afficher("/mot-de-passe-oublie");
    await passerALEtapeCode();
    remplirEtapeCode("123456", "nouveau-secret", "autre-secret");
    await soumettre();

    expect(erreurDuChamp("confirmation-mdp")).toEqual({
      texte: "Les deux mots de passe ne correspondent pas.",
      invalide: true,
    });
    expect(appelsVers("POST /auth/mot-de-passe-oublie/confirmer")).toHaveLength(0);
  });

  it("mot de passe trop court ou code incomplet : erreurs locales, sans appel", async () => {
    await afficher("/mot-de-passe-oublie");
    await passerALEtapeCode();
    remplirEtapeCode("1234", "court");
    await soumettre();

    expect(erreurDuChamp("code").texte).toBe("Le code doit comporter 6 chiffres.");
    expect(erreurDuChamp("nouveau-mdp").texte).toBe("Au moins 8 caractères.");
    expect(appelsVers("POST /auth/mot-de-passe-oublie/confirmer")).toHaveLength(0);
  });
});

describe("MotDePasseOubliePage — erreurs du serveur", () => {
  it("400 : message `error` affiché tel quel, session gardée", async () => {
    tokens.set("acces", "refresh");
    reponses["GET /auth/me"] = { corps: UTILISATEUR };
    const message = "Code incorrect ou expiré. Vérifiez le code reçu ou demandez-en un nouveau.";
    reponses["POST /auth/mot-de-passe-oublie/confirmer"] = { status: 400, corps: { error: message, details: [] } };
    const router = await afficher("/mot-de-passe-oublie");
    await passerALEtapeCode();
    remplirEtapeCode();
    await soumettre();

    expect(alerte()).toBe(message);
    expect(router.state.location.pathname).toBe("/mot-de-passe-oublie");
    expect(tokens.access()).toBe("acces");
  });

  it("422 sur le numéro : `details` sous le champ, sans passer à l'étape 2", async () => {
    reponses["POST /auth/mot-de-passe-oublie"] = {
      status: 422,
      corps: {
        error: "Numéro de téléphone invalide",
        details: [{ champ: "phone", code: "telephone_invalide", message: "Numéro de téléphone invalide" }],
      },
    };
    await afficher("/mot-de-passe-oublie");
    saisir("phone", "12");
    await soumettre();

    expect(erreurDuChamp("phone")).toEqual({ texte: "Numéro de téléphone invalide", invalide: true });
    expect(champ("phone").getAttribute("aria-describedby")).toContain("phone-aide");
    expect(alerte()).toBeNull();
    expect(conteneur.querySelector("#code")).toBeNull();
  });

  it("422 sur le nouveau mot de passe : `details` sous le champ", async () => {
    reponses["POST /auth/mot-de-passe-oublie/confirmer"] = {
      status: 422,
      corps: {
        error: "nouveau_mot_de_passe : 128 caractères maximum",
        details: [
          {
            champ: "nouveau_mot_de_passe",
            code: "string_too_long",
            message: "nouveau_mot_de_passe : 128 caractères maximum",
          },
        ],
      },
    };
    await afficher("/mot-de-passe-oublie");
    await passerALEtapeCode();
    remplirEtapeCode("123456", "x".repeat(129));
    await soumettre();

    expect(erreurDuChamp("nouveau-mdp")).toEqual({
      texte: "nouveau_mot_de_passe : 128 caractères maximum",
      invalide: true,
    });
    expect(alerte()).toBeNull();
  });

  it("429 sur la demande : message tel quel, bouton bloqué pendant `reessayer_dans`", async () => {
    reponses["POST /auth/mot-de-passe-oublie"] = {
      status: 429,
      corps: { error: "Trop de tentatives. Réessayez dans 40 minutes.", details: [], reessayer_dans: 2400 },
    };
    await afficher("/mot-de-passe-oublie");
    saisir("phone", "622529252");
    await soumettre();

    expect(alerte()).toBe("Trop de tentatives. Réessayez dans 40 minutes.");
    const demande = bouton(/Recevoir un code/);
    expect(demande.disabled).toBe(true);
    expect(demande.textContent).toBe("Recevoir un code par SMS (dans 40 min)");
    await laisserFiler(2400_000);
    expect(demande.disabled).toBe(false);
  });

  it("429 sur la confirmation : message tel quel, validation bloquée", async () => {
    reponses["POST /auth/mot-de-passe-oublie/confirmer"] = {
      status: 429,
      corps: { error: "Trop de tentatives. Réessayez dans 30 secondes.", details: [], reessayer_dans: 30 },
    };
    await afficher("/mot-de-passe-oublie");
    await passerALEtapeCode();
    remplirEtapeCode();
    await soumettre();

    expect(alerte()).toBe("Trop de tentatives. Réessayez dans 30 secondes.");
    expect(bouton(/Réessayer dans/).textContent).toBe("Réessayer dans 30 s");
    expect(bouton(/Réessayer dans/).disabled).toBe(true);
  });

  it("serveur sans la route (404) : erreur propre", async () => {
    await afficher("/mot-de-passe-oublie");
    saisir("phone", "622529252");
    await soumettre();

    expect(alerte()).toBe("La récupération par SMS n'est pas encore disponible. Réessayez plus tard.");
    expect(conteneur.querySelector("#code")).toBeNull();
  });
});
