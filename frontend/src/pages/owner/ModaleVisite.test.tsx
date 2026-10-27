/**
 * Planification d'une visite (lot 2.7) : le sélecteur n'offre que des dates
 * à venir, dans les 365 prochains jours, comme le serveur ; une date passée
 * est refusée sans appel, et le refus du serveur reste affiché.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const planifierVisite = vi.fn();

vi.mock("../../api", async (original) => {
  const reel = await original<typeof import("../../api")>();
  return { ...reel, matchesAPI: { ...reel.matchesAPI, planifierVisite } };
});

const { ModaleVisite } = await import("./OwnerMatches");
const { ApiError } = await import("../../api/client");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 10 novembre 2026, 14:30:20 à l'heure de l'appareil (quel que soit le fuseau).
const MAINTENANT = new Date(2026, 10, 10, 14, 30, 20);

let racine: ReturnType<typeof createRoot> | null = null;
let conteneur: HTMLDivElement;
const onPlanifie = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MAINTENANT);
  planifierVisite.mockReset();
  onPlanifie.mockReset();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() =>
    racine!.render(<ModaleVisite matchId="M1" onFerme={() => undefined} onPlanifie={onPlanifie} />),
  );
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function champ() {
  return conteneur.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
}

function saisir(valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(champ(), valeur);
    champ().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function valider() {
  const bouton = [...conteneur.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Confirmer la visite"),
  )!;
  await act(async () => bouton.click());
}

function alerte() {
  return conteneur.querySelector('[role="alert"]')?.textContent ?? null;
}

describe("ModaleVisite — date de visite à venir", () => {
  it("borne le sélecteur de la minute suivante à dans 365 jours, et affiche la règle", () => {
    expect(champ().min).toBe("2026-11-10T14:31");
    expect(champ().max).toBe("2027-11-10T14:30");
    expect(conteneur.textContent).toContain(
      "La visite doit être fixée à une date à venir, dans les 365 prochains jours.",
    );
  });

  it("refuse une date passée sans appeler le serveur", async () => {
    saisir("2026-11-10T14:30"); // minute en cours : déjà entamée, donc passée
    await valider();

    expect(planifierVisite).not.toHaveBeenCalled();
    expect(alerte()).toBe("La visite doit être fixée à une date future");
    expect(onPlanifie).not.toHaveBeenCalled();

    // Corriger la date efface le message.
    saisir("2026-11-12T10:00");
    expect(alerte()).toBeNull();
  });

  it("refuse une date à plus de 365 jours sans appeler le serveur", async () => {
    saisir("2027-11-10T14:31");
    await valider();

    expect(planifierVisite).not.toHaveBeenCalled();
    expect(alerte()).toBe("La visite doit être fixée dans les 365 prochains jours");
  });

  it("envoie une date valide telle quelle, sans fuseau", async () => {
    planifierVisite.mockResolvedValue({ message: "Visite planifiée", match: { id: "M1" } });
    saisir("2026-11-10T14:31");
    await valider();

    expect(planifierVisite).toHaveBeenCalledWith("M1", "2026-11-10T14:31");
    expect(onPlanifie).toHaveBeenCalledTimes(1);
    expect(alerte()).toBeNull();
  });

  it("affiche le refus 422 du serveur", async () => {
    planifierVisite.mockRejectedValue(
      new ApiError("La visite doit être fixée à une date future", 422, {
        error: "La visite doit être fixée à une date future",
        details: [{ champ: "visite_date", code: "date_passee", message: "…" }],
      }),
    );
    saisir("2026-11-15T09:00");
    await valider();

    expect(planifierVisite).toHaveBeenCalledTimes(1);
    expect(alerte()).toBe("La visite doit être fixée à une date future");
    expect(onPlanifie).not.toHaveBeenCalled();
  });
});
