/**
 * Client HTTP : délai, reprises (GET seulement), session conservée en cas de
 * coupure pendant le rafraîchissement du jeton. `fetch` est simulé.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authAPI } from "./index";
import {
  api,
  ApiError,
  CLE_MOTIF_DECONNEXION,
  DELAI_ECRITURE_MS,
  DELAI_REQUETE_MS,
  delaiEnvoi,
  envoyerFichier,
  MESSAGE_RESEAU,
  MESSAGE_SERVEUR_ENDORMI,
  reveilServeur,
  tokens,
} from "./client";

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
  sessionStorage.clear();
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
  it("coupe une tentative de GET au bout de 15 s", async () => {
    fetchSimule.mockImplementation(sansReponse);

    void api.get("/listings/").catch(() => undefined);
    await vi.advanceTimersByTimeAsync(DELAI_REQUETE_MS - 1);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    await vi.advanceTimersByTimeAsync(1 + 1_000);
    expect(fetchSimule).toHaveBeenCalledTimes(2); // coupée puis reprise
    await vi.runAllTimersAsync();
  });

  it.each(["post", "put", "delete"] as const)(
    "laisse 60 s à un %s, sans reprise",
    async (methode) => {
      fetchSimule.mockImplementation(sansReponse);
      const appel =
        methode === "delete" ? api.delete("/listings/1") : api[methode]("/listings/", { prix: 1 });
      let erreur: unknown = null;
      const fin = appel.catch((e: unknown) => (erreur = e));

      await vi.advanceTimersByTimeAsync(DELAI_REQUETE_MS);
      expect(erreur).toBeNull();
      await vi.advanceTimersByTimeAsync(DELAI_ECRITURE_MS - DELAI_REQUETE_MS);
      await fin;
      expect(erreur).toBeInstanceOf(ApiError);
      expect((erreur as ApiError).details).toEqual({ cause: "delai" });
      await vi.runAllTimersAsync();
      expect(fetchSimule).toHaveBeenCalledTimes(1);
    },
  );

  it("coupe aussi un corps de réponse qui cale", async () => {
    // En-tête reçu, corps jamais terminé (3G) : le délai couvre la lecture.
    fetchSimule.mockImplementation(async (_url, init) => {
      const corps = new ReadableStream({
        start(flux) {
          flux.enqueue(new TextEncoder().encode('{"listings": ['));
          init?.signal?.addEventListener("abort", () =>
            flux.error(new DOMException("annulée", "AbortError")),
          );
        },
      });
      return new Response(corps, { status: 200 });
    });

    const r = await jusquauBout(api.get("/listings/"));

    expect(r.ok).toBe(false);
    expect((r as { erreur: ApiError }).erreur.statut).toBe(0);
    expect(fetchSimule).toHaveBeenCalledTimes(3); // GET : reprises
  });

  it("un 200 au corps tronqué est une erreur réseau, rejouée pour un GET", async () => {
    fetchSimule
      .mockResolvedValueOnce(new Response('{"listings": [', { status: 200 }))
      .mockResolvedValueOnce(json({ listings: [] }));

    const r = await jusquauBout(api.get("/listings/"));

    expect(r).toEqual({ ok: true, valeur: { listings: [] } });
  });

  it("un 200 au corps tronqué n'est jamais rejoué pour un POST", async () => {
    fetchSimule.mockResolvedValue(new Response('{"listing": {', { status: 201 }));

    const r = await jusquauBout(api.post("/listings/", {}));

    expect((r as { erreur: ApiError }).erreur.statut).toBe(0);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
  });

  it("une page d'erreur HTML garde son statut", async () => {
    fetchSimule.mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 404 }));

    const r = await jusquauBout(api.get("/listings/"));

    expect((r as { erreur: ApiError }).erreur.statut).toBe(404);
  });

  it("/auth/me ne fait qu'une reprise au démarrage", async () => {
    fetchSimule.mockRejectedValue(new TypeError("Failed to fetch"));

    const r = await jusquauBout(authAPI.moi());

    expect(r.ok).toBe(false);
    expect(fetchSimule).toHaveBeenCalledTimes(2);
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

  it("un 401 sur /auth/password rafraîchit le jeton puis rejoue", async () => {
    tokens.set("acces", "refresh");
    fetchSimule
      .mockResolvedValueOnce(json({ error: "Session expirée" }, 401))
      .mockResolvedValueOnce(json({ access_token: "acces-neuf" }))
      .mockResolvedValueOnce(json({ message: "Mot de passe modifié" }));

    const r = await jusquauBout(api.put("/auth/password", { ancien: "a", nouveau: "b" }));

    expect(r).toEqual({ ok: true, valeur: { message: "Mot de passe modifié" } });
    expect(fetchSimule).toHaveBeenCalledTimes(3);
    expect(tokens.access()).toBe("acces-neuf");
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

describe("identifiants et motif de déconnexion", () => {
  /** Page privée simulée : la déconnexion y redirige vers /login. */
  function surPagePrivee() {
    const lieu = { pathname: "/owner/dashboard", href: "http://localhost/owner/dashboard" };
    vi.stubGlobal("location", lieu);
    return lieu;
  }

  it.each(["/auth/login", "/auth/register"])(
    "un 401 sur %s affiche le message du serveur, sans rafraîchir ni déconnecter",
    async (route) => {
      tokens.set("acces", "refresh");
      const lieu = surPagePrivee();
      fetchSimule.mockResolvedValue(json({ error: "Identifiants incorrects" }, 401));

      const r = await jusquauBout(api.post(route, { email: "a@b.gn", password: "x" }));

      const erreur = (r as { erreur: ApiError }).erreur;
      expect(erreur.message).toBe("Identifiants incorrects");
      expect(erreur.statut).toBe(401);
      expect(fetchSimule).toHaveBeenCalledTimes(1); // pas de /auth/refresh
      expect(tokens.access()).toBe("acces");
      expect(lieu.href).toBe("http://localhost/owner/dashboard");
    },
  );

  it.each([
    [401, "Session révoquée, veuillez vous reconnecter"],
    [403, "Compte désactivé. Contactez le support."],
  ])("un refus %i du rafraîchissement transmet sa raison à /login", async (statut, raison) => {
    tokens.set("acces", "refresh");
    const lieu = surPagePrivee();
    fetchSimule
      .mockResolvedValueOnce(json({ error: "Session expirée" }, 401))
      .mockResolvedValueOnce(json({ error: raison }, statut));

    const r = await jusquauBout(api.get("/owner/stats"));

    expect((r as { erreur: ApiError }).erreur.message).toBe(raison);
    expect(lieu.href).toBe("/login");
    expect(sessionStorage.getItem(CLE_MOTIF_DECONNEXION)).toBe(raison);
    expect(tokens.access()).toBeNull();
  });

  it("un 401 sans jeton de rafraîchissement transmet aussi le message", async () => {
    tokens.set("acces");
    surPagePrivee();
    fetchSimule.mockResolvedValue(json({ error: "Session révoquée, veuillez vous reconnecter" }, 401));

    await jusquauBout(api.get("/owner/stats"));

    expect(sessionStorage.getItem(CLE_MOTIF_DECONNEXION)).toBe(
      "Session révoquée, veuillez vous reconnecter",
    );
  });
});

/* ─── Envoi de fichier (XMLHttpRequest simulé) ─────────────── */

class FauxXhr {
  static instances: FauxXhr[] = [];
  status = 0;
  responseText = "";
  timeout = 0;
  entetes: Record<string, string> = {};
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } =
    { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  url = "";
  envoye = false;

  constructor() {
    FauxXhr.instances.push(this);
  }
  open(_methode: string, url: string) {
    this.url = url;
  }
  setRequestHeader(nom: string, valeur: string) {
    this.entetes[nom] = valeur;
  }
  send() {
    this.envoye = true;
  }
  abort() {
    this.onabort?.();
  }
  progresser(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  repondre(status: number, corps: unknown) {
    this.status = status;
    this.responseText = typeof corps === "string" ? corps : JSON.stringify(corps);
    this.onload?.();
  }
}

/** Laisse s'exécuter les promesses en attente (microtâches). */
const laisserFiler = () => vi.advanceTimersByTimeAsync(0);

function formPhoto() {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(10)], "salon.webp"));
  return form;
}

describe("envoyerFichier", () => {
  beforeEach(() => {
    FauxXhr.instances = [];
    vi.stubGlobal("XMLHttpRequest", FauxXhr);
    tokens.set("acces-expire", "refresh-valide");
  });

  it("401 : un seul rafraîchissement, un seul rejeu, progression remise à 0", async () => {
    fetchSimule.mockResolvedValue(json({ access_token: "acces-neuf" }));
    const progression: number[] = [];

    const envoi = envoyerFichier<{ images: string[] }>("/listings/L1/photos", formPhoto(), {
      onProgression: (f) => progression.push(f),
    });
    const [premier] = FauxXhr.instances;
    premier.progresser(10, 10);
    premier.repondre(401, { error: "Session expirée" });
    await laisserFiler();

    expect(fetchSimule).toHaveBeenCalledTimes(1);
    expect(FauxXhr.instances).toHaveLength(2);
    const rejeu = FauxXhr.instances[1];
    expect(rejeu.entetes.Authorization).toBe("Bearer acces-neuf");
    rejeu.repondre(201, { images: ["/uploads/a.webp"] });

    await expect(envoi).resolves.toEqual({ images: ["/uploads/a.webp"] });
    expect(progression).toEqual([1, 0]);
  });

  it("un second 401 après le rejeu ne relance pas de rafraîchissement", async () => {
    fetchSimule.mockResolvedValue(json({ access_token: "acces-neuf" }));

    const envoi = envoyerFichier("/listings/L1/photos", formPhoto()).catch((e: unknown) => e);
    FauxXhr.instances[0].repondre(401, { error: "Session expirée" });
    await laisserFiler();
    FauxXhr.instances[1].repondre(401, { error: "Session révoquée, veuillez vous reconnecter" });

    const erreur = (await envoi) as ApiError;
    expect(erreur.statut).toBe(401);
    expect(fetchSimule).toHaveBeenCalledTimes(1);
    expect(FauxXhr.instances).toHaveLength(2);
  });

  it("l'annulation par l'appelant donne une AbortError", async () => {
    const controleur = new AbortController();
    const envoi = envoyerFichier("/listings/L1/photos", formPhoto(), {
      signal: controleur.signal,
    }).catch((e: unknown) => e);

    controleur.abort();

    expect(((await envoi) as DOMException).name).toBe("AbortError");
  });

  it("413 : « Photo trop lourde »", async () => {
    const envoi = envoyerFichier("/listings/L1/photos", formPhoto()).catch((e: unknown) => e);
    FauxXhr.instances[0].repondre(413, "<html>Request Entity Too Large</html>");

    const erreur = (await envoi) as ApiError;
    expect(erreur.statut).toBe(413);
    expect(erreur.message).toBe("Photo trop lourde pour le serveur.");
  });

  it("coupure (onerror) : erreur réseau de statut 0, sans reprise", async () => {
    const envoi = envoyerFichier("/listings/L1/photos", formPhoto()).catch((e: unknown) => e);
    FauxXhr.instances[0].onerror?.();

    const erreur = (await envoi) as ApiError;
    expect(erreur.statut).toBe(0);
    expect(erreur.message).toBe(MESSAGE_RESEAU);
    await vi.runAllTimersAsync();
    expect(FauxXhr.instances).toHaveLength(1);
  });

  it("plusieurs 401 simultanés ne font qu'un seul /auth/refresh", async () => {
    let terminerRefresh!: (r: Response) => void;
    fetchSimule.mockImplementation(async (url) => {
      if (String(url).endsWith("/auth/refresh")) {
        return new Promise<Response>((r) => (terminerRefresh = r));
      }
      return json({ error: "Session expirée" }, 401);
    });

    const a = envoyerFichier("/listings/L1/photos", formPhoto());
    const b = envoyerFichier("/listings/L1/photos", formPhoto());
    const c = api.post("/matches/", {}).catch(() => undefined);
    FauxXhr.instances[0].repondre(401, { error: "Session expirée" });
    FauxXhr.instances[1].repondre(401, { error: "Session expirée" });
    await laisserFiler();
    terminerRefresh(json({ access_token: "acces-neuf" }));
    await laisserFiler();

    const appelsRefresh = fetchSimule.mock.calls.filter(([url]) =>
      String(url).endsWith("/auth/refresh"),
    );
    expect(appelsRefresh).toHaveLength(1);
    FauxXhr.instances.slice(2).forEach((x) => x.repondre(201, { images: [] }));
    await Promise.all([a, b, c]);
  });
});

describe("réveil du serveur", () => {
  it("signale le réveil pendant les reprises d'un 503, puis l'éteint", async () => {
    fetchSimule
      .mockResolvedValueOnce(new Response("<html>503</html>", { status: 503 }))
      .mockResolvedValueOnce(json({ ok: 1 }));
    const vu: boolean[] = [];
    const desabonner = reveilServeur.subscribe(() => vu.push(reveilServeur.enCours()));

    const r = await jusquauBout(api.get("/listings/"));
    desabonner();

    expect(r.ok).toBe(true);
    expect(vu).toEqual([true, false]);
    expect(reveilServeur.enCours()).toBe(false);
  });

  it("une coupure du téléphone n'est pas présentée comme un réveil", async () => {
    fetchSimule.mockRejectedValue(new TypeError("Failed to fetch"));
    const vu: boolean[] = [];
    const desabonner = reveilServeur.subscribe(() => vu.push(reveilServeur.enCours()));

    const r = await jusquauBout(api.get("/listings/"));
    desabonner();

    expect(vu).toEqual([]);
    expect((r as { erreur: ApiError }).erreur.message).toBe(MESSAGE_RESEAU);
  });

  it("délai final : message « serveur », pas « réseau du téléphone »", async () => {
    fetchSimule.mockImplementation(sansReponse);

    const r = await jusquauBout(api.get("/listings/"));

    expect((r as { erreur: ApiError }).erreur.message).toBe(MESSAGE_SERVEUR_ENDORMI);
  });

  it("502 final : même message « serveur »", async () => {
    fetchSimule.mockImplementation(async () => new Response("Bad Gateway", { status: 502 }));

    const r = await jusquauBout(api.get("/listings/"));

    expect((r as { erreur: ApiError }).erreur.message).toBe(MESSAGE_SERVEUR_ENDORMI);
  });
});
