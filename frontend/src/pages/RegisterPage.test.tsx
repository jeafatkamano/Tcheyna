/**
 * Inscription en deux étapes (lot 3.14) : validation de chaque étape, saisie
 * conservée au retour (flèche de l'écran et bouton retour d'Android), erreurs
 * du serveur ramenées à l'étape du champ, un seul POST avec les mêmes champs,
 * écran du code SMS seulement avec un numéro.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api";

const inscrire = vi.fn();
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ inscrire }) }));
vi.mock("../hooks/useGeo", () => ({ useGeo: () => ({ villes: ["Conakry", "Kindia"], quartiers: ["Kipé", "Ratoma"] }) }));

const { RegisterPage } = await import("./RegisterPage");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;
let conteneur: HTMLElement;

function Destination() {
  const { pathname, state } = useLocation();
  return <p>Destination {pathname} {JSON.stringify(state)}</p>;
}

beforeEach(() => {
  inscrire.mockReset();
  inscrire.mockImplementation(async (d: { role: string }) => ({ id: "u1", role: d.role }));
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

function ouvrir(chemin = "/inscription?role=tenant", element = <RegisterPage />) {
  const router = createMemoryRouter(
    [
      { path: "/inscription", element },
      { path: "*", Component: Destination },
    ],
    { initialEntries: ["/bienvenue", chemin], initialIndex: 1 },
  );
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<RouterProvider router={router} />));
  return router;
}

const titre = () => conteneur.querySelector("h1")?.textContent;
const champ = (id: string) => conteneur.querySelector<HTMLInputElement>(`#${id}`)!;

function saisir(id: string, valeur: string) {
  const el = champ(id);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, valeur);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function soumettre() {
  await act(async () => {
    conteneur.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

function erreurDe(id: string) {
  const ids = (champ(id).getAttribute("aria-describedby") ?? "").split(" ");
  return ids.map((i) => document.getElementById(i)).find((n) => n?.id.endsWith("-erreur"))?.textContent ?? null;
}

async function remplirEtape1({ phone = "622 52 92 52" } = {}) {
  saisir("nom", "Aminata Diallo");
  saisir("email", "aminata@exemple.com");
  saisir("tel", phone);
  await soumettre();
}

async function remplirEtape2(mdp = "un-bon-secret") {
  saisir("mdp", mdp);
  act(() => conteneur.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await soumettre();
}

describe("RegisterPage, étape 1", () => {
  it("affiche rôle, nom, téléphone (+224) et e-mail, avec les attributs de saisie", () => {
    ouvrir();
    expect(titre()).toBe("Créer votre compte");
    expect(conteneur.querySelector('[aria-label="Étape 1 sur 2"]')).not.toBeNull();
    expect(conteneur.textContent).toContain("+224");
    expect(champ("nom").getAttribute("autocomplete")).toBe("name");
    expect(champ("tel").getAttribute("autocomplete")).toBe("tel");
    expect(champ("tel").getAttribute("inputmode")).toBe("tel");
    expect(champ("email").getAttribute("autocomplete")).toBe("email");
    expect(champ("email").getAttribute("enterkeyhint")).toBe("next");
    expect(champ("mdp" as string)).toBeNull();
  });

  it("refuse de passer à l'étape 2 sans nom ni e-mail valide", async () => {
    ouvrir();
    await soumettre();
    expect(titre()).toBe("Créer votre compte");
    expect(erreurDe("nom")).toBe("Saisissez votre nom complet.");
    expect(erreurDe("email")).toBe("Saisissez votre adresse e-mail.");

    saisir("nom", "Aminata");
    saisir("email", "pas-une-adresse");
    await soumettre();
    expect(titre()).toBe("Créer votre compte");
    expect(erreurDe("email")).toBe("Adresse e-mail invalide.");
  });

  it("le téléphone est facultatif", async () => {
    ouvrir();
    await remplirEtape1({ phone: "" });
    expect(titre()).toBe("Sécurisez votre compte");
  });

  it("le paramètre role présélectionne le rôle ; roleImpose masque le choix", () => {
    ouvrir("/inscription?role=landlord");
    const radios = [...conteneur.querySelectorAll('[role="radio"]')];
    expect(radios.find((r) => r.getAttribute("aria-checked") === "true")?.textContent).toContain("Je loue");
    act(() => racine?.unmount());

    ouvrir("/inscription", <RegisterPage roleImpose="tenant" />);
    expect(conteneur.querySelector('[role="radiogroup"]')!.hasAttribute("hidden")).toBe(true);
  });

  it("garde le lien vers la connexion", () => {
    ouvrir();
    const lien = [...conteneur.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/login");
    expect(lien?.closest("p")?.textContent).toContain("Déjà un compte ?");
  });
});

describe("RegisterPage, passage d'une étape à l'autre", () => {
  it("étape 2 : mot de passe, ville, quartier, conditions ; barre « 2 / 2 »", async () => {
    ouvrir();
    await remplirEtape1();
    expect(titre()).toBe("Sécurisez votre compte");
    expect(conteneur.querySelector('[aria-label="Étape 2 sur 2"]')).not.toBeNull();
    expect(champ("mdp").getAttribute("autocomplete")).toBe("new-password");
    expect(conteneur.querySelector("#ville")).not.toBeNull();
    expect(conteneur.querySelector("#quartier")).not.toBeNull();
    expect(conteneur.querySelector('input[type="checkbox"]')).not.toBeNull();
  });

  it("la flèche de l'étape 2 revient à l'étape 1 sans perdre la saisie", async () => {
    ouvrir();
    await remplirEtape1();
    saisir("mdp", "un-bon-secret");
    const retour = conteneur.querySelector<HTMLButtonElement>('button[aria-label="Étape précédente"]')!;
    await act(async () => retour.click());
    expect(titre()).toBe("Créer votre compte");
    expect(champ("nom").value).toBe("Aminata Diallo");
    expect(champ("email").value).toBe("aminata@exemple.com");
    expect(champ("tel").value).toBe("622 52 92 52");

    await soumettre();
    expect(champ("mdp").value).toBe("un-bon-secret");
  });

  it("le bouton retour d'Android (historique) revient aussi à l'étape 1, saisie conservée", async () => {
    const router = ouvrir();
    await remplirEtape1();
    await act(async () => {
      await router.navigate(-1);
    });
    expect(titre()).toBe("Créer votre compte");
    expect(champ("nom").value).toBe("Aminata Diallo");
    expect(router.state.location.pathname).toBe("/inscription");
  });

  it("étape 2 : mot de passe trop court refusé, sans appel au serveur", async () => {
    ouvrir();
    await remplirEtape1();
    await remplirEtape2("court");
    expect(erreurDe("mdp")).toBe("8 caractères minimum.");
    expect(inscrire).not.toHaveBeenCalled();
  });

  it("« Créer mon compte » reste désactivé tant que les conditions ne sont pas acceptées", async () => {
    ouvrir();
    await remplirEtape1();
    const bouton = [...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Créer mon compte")!;
    expect(bouton.disabled).toBe(true);
  });
});

describe("RegisterPage, envoi", () => {
  it("un seul POST, avec les mêmes champs qu'avant ; avec un numéro : écran du code SMS", async () => {
    const router = ouvrir();
    await remplirEtape1();
    await remplirEtape2();
    expect(inscrire).toHaveBeenCalledOnce();
    expect(inscrire).toHaveBeenCalledWith({
      full_name: "Aminata Diallo",
      email: "aminata@exemple.com",
      phone: "622 52 92 52",
      password: "un-bon-secret",
      pays: "Guinée",
      ville: "Conakry",
      quartier: undefined,
      role: "tenant",
    });
    expect(router.state.location.pathname).toBe("/inscription/verification");
    expect(router.state.location.state).toEqual({ suite: "/onboarding/tenant" });
  });

  it("sans numéro : directement l'onboarding du rôle", async () => {
    const router = ouvrir("/inscription?role=landlord");
    await remplirEtape1({ phone: "" });
    await remplirEtape2();
    expect(inscrire).toHaveBeenCalledWith(expect.objectContaining({ phone: undefined, role: "landlord" }));
    expect(router.state.location.pathname).toBe("/onboarding/owner");
  });

  it("depuis l'onboarding : onInscrit, sans navigation", async () => {
    const onInscrit = vi.fn();
    const router = ouvrir("/inscription", <RegisterPage roleImpose="tenant" onInscrit={onInscrit} />);
    await remplirEtape1();
    await remplirEtape2();
    expect(onInscrit).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe("/inscription");
  });

  it("e-mail déjà utilisé (409) : retour à l'étape 1, erreur sous l'e-mail, saisie conservée", async () => {
    inscrire.mockRejectedValue(
      new ApiError("Cette adresse e-mail est déjà utilisée", 409, { error: "Cette adresse e-mail est déjà utilisée" }),
    );
    ouvrir();
    await remplirEtape1();
    await remplirEtape2();
    expect(titre()).toBe("Créer votre compte");
    expect(erreurDe("email")).toBe("Cette adresse e-mail est déjà utilisée");
    expect(champ("nom").value).toBe("Aminata Diallo");
  });

  it("422 sur le téléphone : retour à l'étape 1, erreur sous le téléphone", async () => {
    inscrire.mockRejectedValue(
      new ApiError("Numéro trop long", 422, {
        error: "Numéro trop long",
        details: [{ champ: "phone", code: "string_too_long", message: "Numéro trop long" }],
      }),
    );
    ouvrir();
    await remplirEtape1();
    await remplirEtape2();
    expect(titre()).toBe("Créer votre compte");
    expect(erreurDe("tel")).toBe("Numéro trop long");
  });

  it("422 sur le mot de passe : on reste à l'étape 2, erreur sous le mot de passe", async () => {
    inscrire.mockRejectedValue(
      new ApiError("Mot de passe trop long", 422, {
        error: "Mot de passe trop long",
        details: [{ champ: "password", code: "string_too_long", message: "Mot de passe trop long" }],
      }),
    );
    ouvrir();
    await remplirEtape1();
    await remplirEtape2();
    expect(titre()).toBe("Sécurisez votre compte");
    expect(erreurDe("mdp")).toBe("Mot de passe trop long");
  });
});
