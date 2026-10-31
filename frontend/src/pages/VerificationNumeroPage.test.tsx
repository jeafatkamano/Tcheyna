/**
 * « Vérifiez votre numéro » après l'inscription (lot 3.14) : envoi
 * automatique unique, compte à rebours, validation du code, « Plus tard »,
 * suite directe sans numéro à vérifier.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "../api";

const envoyerOTP = vi.fn();
const verifierOTP = vi.fn();
const rafraichir = vi.fn();
const session = vi.hoisted(() => ({ user: null as Partial<User> | null }));

vi.mock("../api", async (original) => {
  const reel = await original<typeof import("../api")>();
  return { ...reel, authAPI: { ...reel.authAPI, envoyerOTP, verifierOTP } };
});
vi.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: session.user, rafraichir }) }));

const { VerificationNumeroPage } = await import("./VerificationNumeroPage");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;
let conteneur: HTMLElement;

beforeEach(() => {
  envoyerOTP.mockReset().mockResolvedValue({ message: "Code envoyé" });
  verifierOTP.mockReset().mockResolvedValue({ trust_level: 1 });
  rafraichir.mockReset().mockResolvedValue(null);
  session.user = { id: "u1", role: "tenant", phone: "+224622529252", phone_verified: false };
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

async function ouvrir(etat: unknown = { suite: "/onboarding/tenant" }) {
  const router = createMemoryRouter(
    [
      { path: "/inscription/verification", Component: VerificationNumeroPage },
      { path: "*", element: <p>Suite</p> },
    ],
    { initialEntries: [{ pathname: "/inscription/verification", state: etat }] },
  );
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine!.render(<RouterProvider router={router} />));
  return router;
}

const bouton = (texte: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent === texte);

function saisirCode(code: string) {
  const el = conteneur.querySelector<HTMLInputElement>("#code")!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, code);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("VerificationNumeroPage", () => {
  it("envoie le code une seule fois au numéro saisi, et l'annonce", async () => {
    await ouvrir();
    expect(envoyerOTP).toHaveBeenCalledOnce();
    expect(envoyerOTP).toHaveBeenCalledWith("+224622529252");
    expect(conteneur.querySelector("h1")?.textContent).toBe("Vérifiez votre numéro");
    expect(conteneur.textContent).toContain("a été envoyé au +224 622 52 92 52");
    expect(conteneur.textContent).toContain("Renvoyer le code dans 60 s");
    expect(conteneur.querySelectorAll("input")).toHaveLength(6);
  });

  it("à la fin du compte à rebours, on peut renvoyer le code", async () => {
    vi.useFakeTimers();
    await ouvrir();
    for (let s = 0; s < 60; s++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    const renvoi = bouton("Renvoyer le code")!;
    await act(async () => renvoi.click());
    expect(envoyerOTP).toHaveBeenCalledTimes(2);
  });

  it("« Valider » vérifie le code saisi (ou collé), rafraîchit la session et mène à la suite", async () => {
    const router = await ouvrir();
    const valider = bouton("Valider")!;
    expect(valider.disabled).toBe(true);
    saisirCode("123456");
    expect(valider.disabled).toBe(false);
    await act(async () => {
      conteneur.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(verifierOTP).toHaveBeenCalledWith("123456");
    expect(rafraichir).toHaveBeenCalledOnce();
    expect(router.state.location.pathname).toBe("/onboarding/tenant");
  });

  it("code refusé : message d'erreur, on reste sur l'écran", async () => {
    const { ApiError } = await import("../api");
    verifierOTP.mockRejectedValue(new ApiError("Code invalide", 400));
    const router = await ouvrir();
    saisirCode("000000");
    await act(async () => {
      conteneur.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toBe("Code invalide");
    expect(router.state.location.pathname).toBe("/inscription/verification");
  });

  it("« Plus tard » mène à la suite sans vérifier", async () => {
    const router = await ouvrir({ suite: "/onboarding/owner" });
    await act(async () => bouton("Plus tard")!.click());
    expect(verifierOTP).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe("/onboarding/owner");
  });

  it("sans numéro, ou numéro déjà vérifié : la suite directement, sans envoi", async () => {
    session.user = { id: "u1", role: "tenant", phone: null, phone_verified: false } as Partial<User>;
    const router = await ouvrir();
    expect(router.state.location.pathname).toBe("/onboarding/tenant");
    act(() => racine?.unmount());

    session.user = { id: "u1", role: "landlord", phone: "+224622529252", phone_verified: true };
    const second = await ouvrir(null);
    expect(second.state.location.pathname).toBe("/onboarding/owner");
    expect(envoyerOTP).not.toHaveBeenCalled();
  });

  it("le niveau Basique n'est annoncé qu'aux locataires", async () => {
    await ouvrir();
    expect(conteneur.textContent).toContain("niveau Basique du Passeport");
    act(() => racine?.unmount());
    session.user = { id: "u1", role: "landlord", phone: "+224622529252", phone_verified: false };
    await ouvrir();
    expect(conteneur.textContent).not.toContain("Passeport");
  });
});
