/**
 * Réveil du serveur (lot 3.18) : préchauffage par `/health` à l'ouverture,
 * écritures qui attendent la fin du réveil. L'API est ici sur un autre hôte,
 * comme en production (`VITE_API_URL` absolue) ; `fetch` est simulé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Client = typeof import("./client");

const fetchSimule = vi.fn<typeof fetch>();
let client: Client;

function json(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Réponse de `/health` libérée à la demande. */
function santeEnAttente() {
  let liberer!: () => void;
  let echouer!: () => void;
  const promesse = new Promise<Response>((resolve, reject) => {
    liberer = () => resolve(new Response(null, { status: 200 }));
    echouer = () => reject(new TypeError("Failed to fetch"));
  });
  return { promesse, liberer, echouer };
}

function appels(chemin: string) {
  return fetchSimule.mock.calls.filter(([url]) => String(url).endsWith(chemin));
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchSimule);
  vi.stubEnv("VITE_API_URL", "https://api.exemple.test/api");
  fetchSimule.mockReset();
  localStorage.clear();
  vi.resetModules();
  client = await import("./client");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("préchauffage", () => {
  it("interroge /health en no-cors, sans jeton ni cookie, une seule fois à la fois", async () => {
    const sante = santeEnAttente();
    fetchSimule.mockReturnValue(sante.promesse);

    const a = client.prechaufferServeur();
    const b = client.prechaufferServeur();
    sante.liberer();
    await Promise.all([a, b]);

    expect(fetchSimule).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSimule.mock.calls[0];
    expect(url).toBe("https://api.exemple.test/health");
    expect(init).toMatchObject({ mode: "no-cors", credentials: "omit", cache: "no-store" });
    expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBeUndefined();
  });

  it("ne réveille pas un serveur qui a répondu il y a moins de 10 min", async () => {
    fetchSimule.mockResolvedValue(json({ ok: 1 }));
    await client.api.get("/listings/");
    fetchSimule.mockClear();

    await vi.advanceTimersByTimeAsync(client.INACTIVITE_AVANT_REVEIL_MS - 1_000);
    await client.prechaufferServeur();
    expect(fetchSimule).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    void client.prechaufferServeur();
    expect(appels("/health")).toHaveLength(1);
    await vi.runAllTimersAsync();
  });

  it("un 503 du proxy Render ne prouve pas que le serveur est éveillé", async () => {
    fetchSimule.mockResolvedValue(new Response("", { status: 503 }));
    await client.api.get("/listings/", { reprises: 0 }).catch(() => undefined);
    fetchSimule.mockClear();
    fetchSimule.mockResolvedValue(new Response(null, { status: 200 }));

    await client.prechaufferServeur();

    expect(appels("/health")).toHaveLength(1);
  });

  it("annonce le réveil au-delà de 2 s seulement, puis l'éteint", async () => {
    const sante = santeEnAttente();
    fetchSimule.mockReturnValue(sante.promesse);

    const fin = client.prechaufferServeur();
    await vi.advanceTimersByTimeAsync(client.SEUIL_ANNONCE_REVEIL_MS - 1);
    expect(client.reveilServeur.enCours()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.reveilServeur.enCours()).toBe(true);

    sante.liberer();
    await fin;
    expect(client.reveilServeur.enCours()).toBe(false);
  });

  it("un réveil rapide reste muet", async () => {
    fetchSimule.mockResolvedValue(new Response(null, { status: 200 }));
    const vu: boolean[] = [];
    const desabonner = client.reveilServeur.subscribe(() => vu.push(client.reveilServeur.enCours()));

    await client.prechaufferServeur();
    await vi.runAllTimersAsync();
    desabonner();

    expect(vu).toEqual([]);
  });

  it("abandonne au bout de 90 s sans rejeter", async () => {
    fetchSimule.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("annulée", "AbortError")));
        }),
    );
    let fini = false;
    void client.prechaufferServeur().then(() => (fini = true));

    await vi.advanceTimersByTimeAsync(client.DELAI_REVEIL_MS - 1);
    expect(fini).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fini).toBe(true);
    expect(client.reveilServeur.enCours()).toBe(false);
  });
});

describe("écritures pendant le réveil", () => {
  it("un POST attend la fin du réveil avant de partir", async () => {
    const sante = santeEnAttente();
    fetchSimule.mockImplementation(async (url) =>
      String(url).endsWith("/health") ? sante.promesse : json({ access_token: "a", refresh_token: "r", user: {} }),
    );

    void client.prechaufferServeur();
    const connexion = client.api.post("/auth/login", { email: "a@b.c", password: "x" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(appels("/auth/login")).toHaveLength(0);

    sante.liberer();
    await connexion;
    expect(appels("/auth/login")).toHaveLength(1);
  });

  it("un réveil qui échoue (réseau) laisse tout de même partir l'écriture", async () => {
    const sante = santeEnAttente();
    fetchSimule.mockImplementation(async (url) =>
      String(url).endsWith("/health") ? sante.promesse : json({ ok: 1 }, 201),
    );

    void client.prechaufferServeur();
    const envoi = client.api.post("/messages/", { texte: "Bonjour" });
    sante.echouer();

    await expect(envoi).resolves.toEqual({ ok: 1 });
    expect(appels("/messages/")).toHaveLength(1);
  });

  it("une écriture annulée pendant le réveil ne part jamais", async () => {
    const sante = santeEnAttente();
    fetchSimule.mockReturnValue(sante.promesse);
    const controleur = new AbortController();

    void client.prechaufferServeur();
    const envoi = client.api.post("/messages/", { texte: "Bonjour" }, { signal: controleur.signal });
    controleur.abort();

    await expect(envoi).rejects.toMatchObject({ name: "AbortError" });
    sante.liberer();
    await vi.runAllTimersAsync();
    expect(appels("/messages/")).toHaveLength(0);
  });

  it("un GET n'attend pas le réveil : il part aussitôt", async () => {
    const sante = santeEnAttente();
    fetchSimule.mockImplementation(async (url) =>
      String(url).endsWith("/health") ? sante.promesse : json({ ok: 1 }),
    );

    void client.prechaufferServeur();
    await expect(client.api.get("/listings/")).resolves.toEqual({ ok: 1 });
    sante.liberer();
  });
});

describe("surveillance", () => {
  it("réveille à l'ouverture, puis au retour au premier plan après 10 min de silence", async () => {
    fetchSimule.mockResolvedValue(new Response(null, { status: 200 }));

    client.surveillerReveilServeur();
    await vi.advanceTimersByTimeAsync(0);
    expect(appels("/health")).toHaveLength(1);

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(appels("/health")).toHaveLength(1); // contact récent : rien

    await vi.advanceTimersByTimeAsync(client.INACTIVITE_AVANT_REVEIL_MS + 1);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(appels("/health")).toHaveLength(2);
  });

  it("un second appel n'empile pas d'écouteurs", async () => {
    fetchSimule.mockResolvedValue(new Response(null, { status: 200 }));
    const ajout = vi.spyOn(document, "addEventListener");

    client.surveillerReveilServeur();
    client.surveillerReveilServeur();

    expect(ajout.mock.calls.filter(([type]) => type === "visibilitychange")).toHaveLength(1);
    await vi.runAllTimersAsync();
  });
});
