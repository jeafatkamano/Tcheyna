/**
 * Cycle de l'annonce (lot 2.2) : retrait par PUT /retirer, avec repli sur
 * l'ancien DELETE tant que le serveur ne connaît pas la nouvelle route ;
 * liste « Mes annonces » avec les annonces retirées. `fetch` est simulé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./client";
import { listingsAPI } from "./index";

const fetchSimule = vi.fn<typeof fetch>();

function json(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function appel(n: number) {
  const [url, init] = fetchSimule.mock.calls[n];
  return { url: String(url), methode: init?.method };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSimule);
  fetchSimule.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listingsAPI.retirer", () => {
  it("appelle PUT /listings/<id>/retirer", async () => {
    fetchSimule.mockResolvedValueOnce(json({ message: "Annonce retirée", listing: { id: "L1" } }));

    const reponse = await listingsAPI.retirer("L1");

    expect(reponse.message).toBe("Annonce retirée");
    expect(fetchSimule).toHaveBeenCalledTimes(1);
    expect(appel(0)).toEqual({ url: "/api/listings/L1/retirer", methode: "PUT" });
  });

  it.each([404, 405])("retombe sur DELETE quand la route répond %i (serveur antérieur)", async (statut) => {
    fetchSimule
      .mockResolvedValueOnce(new Response("<h1>Not Found</h1>", { status: statut }))
      .mockResolvedValueOnce(json({ message: "Annonce retirée" }));

    const reponse = await listingsAPI.retirer("L1");

    expect(reponse.message).toBe("Annonce retirée");
    expect(fetchSimule).toHaveBeenCalledTimes(2);
    expect(appel(1)).toEqual({ url: "/api/listings/L1", methode: "DELETE" });
  });

  it("ne retombe pas sur DELETE pour un autre refus (403)", async () => {
    fetchSimule.mockResolvedValueOnce(
      json({ error: "Cette annonce ne vous appartient pas" }, 403),
    );

    const erreur = await listingsAPI.retirer("L1").catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(ApiError);
    expect((erreur as ApiError).statut).toBe(403);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
  });
});

describe("listingsAPI.reactiver et mesAnnonces", () => {
  it("remet en ligne par PUT /listings/<id>/reactiver", async () => {
    fetchSimule.mockResolvedValueOnce(json({ message: "Annonce remise en ligne", listing: {} }));

    await listingsAPI.reactiver("L1");

    expect(appel(0)).toEqual({ url: "/api/listings/L1/reactiver", methode: "PUT" });
  });

  it("ajoute ?inclure_retirees=1 seulement sur demande", async () => {
    fetchSimule.mockImplementation(async () => json({ listings: [], total: 0, stats: {} }));

    await listingsAPI.mesAnnonces();
    await listingsAPI.mesAnnonces({ inclure_retirees: true });

    expect(appel(0).url).toBe("/api/listings/mes-annonces");
    expect(appel(1).url).toBe("/api/listings/mes-annonces?inclure_retirees=1");
  });
});
