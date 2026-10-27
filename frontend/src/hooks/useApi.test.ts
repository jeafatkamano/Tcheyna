/**
 * useApi : rechargement sans perdre les données, sondage suspendu quand
 * l'onglet est caché, annulation au démontage. Rendu React minimal dans
 * happy-dom, sans bibliothèque de test supplémentaire.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { codeErreur, useAction, useApi } from "./useApi";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Etat = ReturnType<typeof useApi<number>>;

function monter(requete: (signal: AbortSignal) => Promise<number>, intervalle?: number) {
  const vu: { courant?: Etat } = {};
  function Sonde() {
    vu.courant = useApi(requete, [], { intervalle });
    return null;
  }
  const racine: Root = createRoot(document.createElement("div"));
  act(() => racine.render(createElement(Sonde)));
  return { vu, racine };
}

function visibilite(etat: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: etat, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibilite("visible");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useApi", () => {
  it("un rechargement garde les données et n'affiche pas le chargement", async () => {
    let n = 0;
    const { vu, racine } = monter(async () => ++n);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(vu.courant).toMatchObject({ data: 1, chargement: false });

    let pendant: Etat | undefined;
    await act(async () => {
      const p = vu.courant!.recharger();
      pendant = vu.courant;
      await p;
    });
    expect(pendant).toMatchObject({ data: 1, chargement: false });
    expect(vu.courant).toMatchObject({ data: 2, chargement: false, actualisation: false });
    act(() => racine.unmount());
  });

  it("une erreur de rechargement ne remplace pas les données", async () => {
    const requete = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(7)
      .mockRejectedValueOnce(new ApiError("Connexion lente ou absente.", 0));
    const { vu, racine } = monter(requete);
    await act(() => vi.advanceTimersByTimeAsync(0));

    await act(() => vu.courant!.recharger());

    expect(vu.courant).toMatchObject({
      data: 7,
      erreur: null,
      erreurActualisation: "Connexion lente ou absente.",
    });
    act(() => racine.unmount());
  });

  it("le sondage s'arrête quand l'onglet est caché et reprend à son retour", async () => {
    const requete = vi.fn(async () => 1);
    const { racine } = monter(requete, 15_000);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(requete).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(requete).toHaveBeenCalledTimes(2);

    act(() => visibilite("hidden"));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(requete).toHaveBeenCalledTimes(2);

    act(() => visibilite("visible"));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(requete).toHaveBeenCalledTimes(3); // rechargement immédiat au retour

    act(() => racine.unmount());
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(requete).toHaveBeenCalledTimes(3); // plus rien après démontage
  });

  it("annule la requête en vol au démontage", async () => {
    let signalRecu: AbortSignal | undefined;
    const { racine } = monter((signal) => {
      signalRecu = signal;
      return new Promise<number>(() => undefined);
    });

    act(() => racine.unmount());

    expect(signalRecu?.aborted).toBe(true);
  });
});

describe("codeErreur et useAction.code", () => {
  const refus = () =>
    new ApiError("Vérifiez votre numéro", 403, {
      error: "Vérifiez votre numéro",
      details: [{ champ: "__root__", code: "telephone_non_verifie", message: "…" }],
    });

  it("lit le code stable du premier détail", () => {
    expect(codeErreur(refus())).toBe("telephone_non_verifie");
  });

  it("null sans code, pour une erreur de transport ou une erreur quelconque", () => {
    expect(codeErreur(new ApiError("Refusé", 403, { error: "Refusé" }))).toBeNull();
    expect(codeErreur(new ApiError("Refusé", 403))).toBeNull();
    expect(codeErreur(new ApiError("Hors ligne", 0, { cause: "reseau" }))).toBeNull();
    expect(codeErreur(new ApiError("?", 422, { details: "texte" }))).toBeNull();
    expect(codeErreur(new Error("boum"))).toBeNull();
  });

  it("useAction expose le code du refus, effacé par reinitialiserErreur", async () => {
    const vu: { courant?: ReturnType<typeof useAction<[], never>> } = {};
    function Sonde() {
      vu.courant = useAction(() => Promise.reject(refus()));
      return null;
    }
    const racine: Root = createRoot(document.createElement("div"));
    act(() => racine.render(createElement(Sonde)));

    await act(async () => {
      await vu.courant!.executer();
    });
    expect(vu.courant!.erreur).toBe("Vérifiez votre numéro");
    expect(vu.courant!.code).toBe("telephone_non_verifie");

    act(() => vu.courant!.reinitialiserErreur());
    expect(vu.courant!.erreur).toBeNull();
    expect(vu.courant!.code).toBeNull();
    act(() => racine.unmount());
  });
});
