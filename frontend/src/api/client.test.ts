/**
 * Client HTTP : délai, reprises (GET seulement), session conservée en cas de
 * coupure pendant le rafraîchissement du jeton. `fetch` est simulé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError, DELAI_REQUETE_MS, delaiEnvoi, MESSAGE_RESEAU, tokens } from "./client";

const fetchSimule = vi.fn<typeof fetch>();

function json(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Une requête qui ne répond jamais, mais obéit à l'annulation. */
function sansReponse(_url: unknown, init?: RequestInit) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("annulée", "AbortError")),
    );
  });
}

/** Lance la requête et laisse s'écouler toutes les minuteries (pauses, délais). */
async function jusquauBout<T>(promesse: Promise<T>) {
  const resultat = promesse.then(
    (valeur) => ({ ok: true as const, valeur }),
    (erreur: unknown) => ({ ok: false as const, erreur }),
  );
  await vi.runAllTimersAsync();
  return resultat;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchSimule);
  fetchSimule.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reprises", () => {
  it("rejoue un GET deux fois après une coupure, puis réussit", async () => {
    fetchSimule
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json({ ok: 1 }));

    const r = await jusquauBout(api.get("/listings/"));

    expect(r).toEqual({ ok: true, valeur: { ok: 1 } });
    expect(fetchSimule).toHaveBeenCalledTimes(3);
  });

  it("espace les reprises d'environ 1 s puis 3 s", async () => {
    fetchSimule.mockRejectedValue(new TypeError("Failed to fetch"));
    vi.spyOn(Math, "random").mockReturnValue(0.5); // aléa neutre

    const promesse = api.get("/listings/").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchSimule).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchSimule).toHaveBeenCalledTimes(3);
    await promesse;
  });

  it("abandonne après deux reprises avec un message en français", async () => {
    fetchSimule.mockRejectedValue(new TypeError("Failed to fetch"));

    const r = await jusquauBout(api.get("/listings/"));

    expect(fetchSimule).toHaveBeenCalledTimes(3);
    expect(r.ok).toBe(false);
    const erreur = (r as { erreur: ApiError }).erreur;
    expect(erreur).toBeInstanceOf(ApiError);
    expect(erreur.statut).toBe(0);
    expect(erreur.message).toBe(MESSAGE_RESEAU);
    expect(erreur.message).toMatch(/^Connexion lente ou absente/);
  });

  it("rejoue un GET sur 503 (serveur qui se réveille)", async () => {
    fetchSimule
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(json({ ok: 1 }));

    const r = await jusquauBout(api.get("/listings/"));

    expect(r.ok).toBe(true);
    expect(fetchSimule).toHaveBeenCalledTimes(2);
  });

  it.each([400, 404, 429, 500])("ne rejoue pas un GET en %i", async (statut) => {
    fetchSimule.mockResolvedValue(json({ error: "Refusé" }, statut));

    const r = await jusquauBout(api.get("/listings/"));

    expect(r.ok).toBe(false);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
  });

  it.each(["post", "put", "delete"] as const)("ne rejoue jamais un %s", async (methode) => {
    fetchSimule.mockRejectedValue(new TypeError("Failed to fetch"));

    const appel =
      methode === "delete" ? api.delete("/listings/1") : api[methode]("/listings/", { prix: 1 });
    const r = await jusquauBout(appel);

    expect(r.ok).toBe(false);
    expect((r as { erreur: ApiError }).erreur.statut).toBe(0);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
  });

  it("ne rejoue pas une requête annulée par l'appelant", async () => {
    fetchSimule.mockImplementation(sansReponse);
    const controleur = new AbortController();

    const r = jusquauBout(api.get("/listings/", { signal: controleur.signal }));
    controleur.abort();

    const resultat = await r;
    expect(resultat.ok).toBe(false);
    expect((resultat as { erreur: DOMException }).erreur.name).toBe("AbortError");
    expect(fetchSimule).toHaveBeenCalledTimes(1);
  });
});

describe("délai", () => {
  it("abandonne une tentative au bout de 15 s", async () => {
    fetchSimule.mockImplementation(sansReponse);

    const promesse = api.post("/messages/conversations/1", { contenu: "Bonjour" });
    const resultat = promesse.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(DELAI_REQUETE_MS - 1);
    let fini = false;
    void resultat.then(() => (fini = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(fini).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const erreur = (await resultat) as ApiError;
    expect(erreur).toBeInstanceOf(ApiError);
    expect(erreur.statut).toBe(0);
    expect(erreur.details).toEqual({ cause: "delai" });
  });

  it("borne chaque tentative d'un GET (3 × 15 s au pire, plus les pauses)", async () => {
    fetchSimule.mockImplementation(sansReponse);

    const r = await jusquauBout(api.get("/listings/"));

    expect(r.ok).toBe(false);
    expect(fetchSimule).toHaveBeenCalledTimes(3);
  });
});

describe("session", () => {
  beforeEach(() => {
    tokens.set("acces-expire", "refresh-valide");
  });

  it("rafraîchit le jeton sur 401 puis rejoue la requête", async () => {
    fetchSimule
      .mockResolvedValueOnce(json({ error: "Session expirée" }, 401))
      .mockResolvedValueOnce(json({ access_token: "acces-neuf" }))
      .mockResolvedValueOnce(json({ ok: 1 }));

    const r = await jusquauBout(api.post("/matches/", {}));

    expect(r).toEqual({ ok: true, valeur: { ok: 1 } });
    expect(tokens.access()).toBe("acces-neuf");
    const [, , rejeu] = fetchSimule.mock.calls;
    expect((rejeu[1]?.headers as Record<string, string>).Authorization).toBe("Bearer acces-neuf");
  });

  it("une coupure pendant le rafraîchissement ne déconnecte pas", async () => {
    fetchSimule
      .mockResolvedValueOnce(json({ error: "Session expirée" }, 401))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const r = await jusquauBout(api.post("/matches/", {}));

    expect(r.ok).toBe(false);
    expect((r as { erreur: ApiError }).erreur.statut).toBe(0);
    expect(tokens.access()).toBe("acces-expire");
    expect(tokens.refresh()).toBe("refresh-valide");
  });

  it("un rafraîchissement trop long ne déconnecte pas non plus", async () => {
    fetchSimule
      .mockResolvedValueOnce(json({ error: "Session expirée" }, 401))
      .mockImplementationOnce(sansReponse);

    const r = await jusquauBout(api.post("/matches/", {}));

    expect((r as { erreur: ApiError }).erreur.statut).toBe(0);
    expect(tokens.refresh()).toBe("refresh-valide");
  });

  it("un serveur en panne pendant le rafraîchissement ne déconnecte pas", async () => {
    fetchSimule
      .mockResolvedValueOnce(json({ error: "Session expirée" }, 401))
      .mockResolvedValueOnce(json({ error: "Erreur interne du serveur" }, 500));

    const r = await jusquauBout(api.post("/matches/", {}));

    expect((r as { erreur: ApiError }).erreur.statut).toBe(500);
    expect(tokens.refresh()).toBe("refresh-valide");
  });

  it.each([401, 403])("un refus (%i) du rafraîchissement déconnecte", async (statut) => {
    fetchSimule
      .mockResolvedValueOnce(json({ error: "Session expirée" }, 401))
      .mockResolvedValueOnce(json({ error: "Session révoquée" }, statut));

    const r = await jusquauBout(api.post("/matches/", {}));

    expect((r as { erreur: ApiError }).erreur.statut).toBe(401);
    expect(tokens.access()).toBeNull();
    expect(tokens.refresh()).toBeNull();
  });
});

describe("envois de fichiers", () => {
  it("un formulaire multipart n'est pas coupé à 15 s", async () => {
    fetchSimule.mockImplementation(sansReponse);
    const form = new FormData();
    form.append("files", new File([new Uint8Array(4 * 1024 * 1024)], "titre.pdf"));

    let fini = false;
    const promesse = api.post("/listings/1/documents", form).catch(() => (fini = true));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fini).toBe(false);
    await vi.runAllTimersAsync();
    await promesse;
    expect(fini).toBe(true);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
  });

  it("délai proportionné au poids, jamais sous 60 s", () => {
    expect(delaiEnvoi(300 * 1024)).toBe(60_000);
    expect(delaiEnvoi(8 * 1024 * 1024)).toBeGreaterThan(300_000);
  });
});
