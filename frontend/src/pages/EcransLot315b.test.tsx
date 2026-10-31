/**
 * Écrans du lot 3.15b : liste des discussions, discussion, profil du
 * locataire, barre de navigation du bas ; heure des messages.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Conversation, User } from "../api";

const session = vi.hoisted(() => ({ user: null as User | null }));
const api = vi.hoisted(() => ({
  conversations: vi.fn(),
  filParMatch: vi.fn(),
  modeles: vi.fn(),
  nonLus: vi.fn(),
  compteur: vi.fn(),
  detailMatch: vi.fn(),
  mesCandidatures: vi.fn(),
  mesDemandes: vi.fn(),
  passeport: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: session.user, rafraichir: vi.fn(), deconnecter: vi.fn(), chargement: false }),
}));
vi.mock("../hooks/useGeo", () => ({ useGeo: () => ({ villes: ["Conakry"], quartiers: ["Kipé"], typesBien: [] }) }));
vi.mock("../api", async (original) => {
  const reel = await original<typeof import("../api")>();
  return {
    ...reel,
    messagesAPI: {
      ...reel.messagesAPI,
      conversations: api.conversations,
      filParMatch: api.filParMatch,
      modeles: api.modeles,
      nonLus: api.nonLus,
    },
    notificationsAPI: { ...reel.notificationsAPI, compteur: api.compteur },
    matchesAPI: {
      ...reel.matchesAPI,
      detail: api.detailMatch,
      mesCandidatures: api.mesCandidatures,
      mesDemandes: api.mesDemandes,
    },
    passportAPI: { ...reel.passportAPI, recuperer: api.passeport },
    avisAPI: { ...reel.avisAPI, pourUtilisateur: () => Promise.resolve({ avis: [], note_moyenne: null, nb_avis: 0 }) },
  };
});

const { formatHeureMessage } = await import("../lib/format");
const { MessagesList } = await import("./shared/MessagesList");
const { ConversationPage } = await import("./shared/ConversationPage");
const { TenantProfile } = await import("./tenant/TenantProfile");
const { OwnerProfile } = await import("./owner/OwnerProfile");
const { Layout } = await import("../components/Layout");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;
let conteneur: HTMLElement;

const LOCATAIRE = {
  id: "moi",
  role: "tenant",
  full_name: "Aminata Diallo",
  trust_level: 3,
  phone_verified: true,
} as User;
const PROPRIETAIRE = { id: "autre", role: "landlord", full_name: "Ibrahima Sow" } as User;
const ANNONCE = { id: "a1", title: "Appartement lumineux", prix: 3_500_000, devise: "GNF", images: [] };

beforeEach(() => {
  session.user = LOCATAIRE;
  Object.values(api).forEach((f) => f.mockReset());
  api.modeles.mockResolvedValue({ cote: "locataire", modeles: [{ id: "t1", texte: "Merci, à samedi !" }] });
  api.nonLus.mockResolvedValue({ non_lus: 3 });
  api.compteur.mockResolvedValue({ non_lues: 0 });
  api.detailMatch.mockResolvedValue({ id: "M1", status: "accepted", visite_date: null });
  api.mesCandidatures.mockResolvedValue({ matches: [], stats: {} });
  api.mesDemandes.mockResolvedValue({ matches: [], stats: {} });
});
afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

async function ouvrir(chemin: string, routes: Parameters<typeof createMemoryRouter>[0]) {
  const router = createMemoryRouter([...routes, { path: "*", element: <p>Ailleurs</p> }], {
    initialEntries: [chemin],
  });
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine!.render(<RouterProvider router={router} />));
  await act(async () => new Promise((r) => setTimeout(r, 5)));
  return router;
}

describe("formatHeureMessage", () => {
  const maintenant = new Date(2026, 9, 31, 15, 0);
  it("heure aujourd'hui, « Hier », jour de la semaine, puis date", () => {
    expect(formatHeureMessage(new Date(2026, 9, 31, 10, 42).toISOString(), maintenant)).toBe("10:42");
    expect(formatHeureMessage(new Date(2026, 9, 30, 9, 0).toISOString(), maintenant)).toBe("Hier");
    expect(formatHeureMessage(new Date(2026, 9, 26, 9, 0).toISOString(), maintenant)).toMatch(/^Lun\.?$/);
    expect(formatHeureMessage(new Date(2026, 9, 12, 9, 0).toISOString(), maintenant)).toMatch(/^12 oct/);
    expect(formatHeureMessage(null, maintenant)).toBe("");
  });
});

describe("MessagesList", () => {
  const conv = (n: number, extra: Partial<Conversation> = {}) =>
    ({
      id: `c${n}`,
      match_id: `M${n}`,
      listing: ANNONCE,
      interlocuteur: PROPRIETAIRE,
      nb_non_lus: 0,
      last_message_at: null,
      dernier_message: {
        id: "m",
        sender_id: "autre",
        contenu: "Oui ! Visite possible samedi.",
        lu: false,
        created_at: null,
      },
      ...extra,
    }) as unknown as Conversation;

  it("titre de l'annonce, dernier message, non-lus et statut de la candidature", async () => {
    api.conversations.mockResolvedValue({
      conversations: [
        conv(1, { nb_non_lus: 2 }),
        conv(2, {
          dernier_message: { id: "m2", sender_id: "moi", contenu: "Merci, je confirme.", lu: true, created_at: null },
        }),
      ],
      total: 2,
      non_lus: 2,
    });
    api.mesCandidatures.mockResolvedValue({
      matches: [
        { id: "M1", status: "accepted" },
        { id: "M2", status: "pending" },
      ],
      stats: {},
    });
    await ouvrir("/messages", [{ path: "/messages", Component: MessagesList }]);

    const [premiere, seconde] = [...conteneur.querySelectorAll<HTMLAnchorElement>('a[href^="/messages/"]')];
    expect(premiere.textContent).toContain("Appartement lumineux");
    expect(premiere.textContent).toContain("Oui ! Visite possible samedi.");
    expect(premiere.querySelector('[aria-label="2 non lus"]')).not.toBeNull();
    expect(premiere.textContent).toContain("Acceptée");
    expect(seconde.textContent).toContain("Vous : Merci, je confirme.");
    expect(seconde.textContent).toContain("En attente");
    expect(conteneur.textContent).toContain("2 messages non lus");
  });

  it("propriétaire : les statuts viennent de ses demandes reçues", async () => {
    session.user = { ...PROPRIETAIRE, id: "u2" } as User;
    api.conversations.mockResolvedValue({ conversations: [conv(1)], total: 1, non_lus: 0 });
    api.mesDemandes.mockResolvedValue({ matches: [{ id: "M1", status: "completed" }], stats: {} });
    await ouvrir("/messages", [{ path: "/messages", Component: MessagesList }]);
    expect(api.mesCandidatures).not.toHaveBeenCalled();
    expect(conteneur.querySelector('a[href="/messages/M1"]')?.textContent).toContain("Location conclue");
    expect(conteneur.textContent).toContain("Vos échanges avec les candidats");
  });

  it("statuts indisponibles : la liste s'affiche quand même, sans pastille", async () => {
    api.conversations.mockResolvedValue({ conversations: [conv(1)], total: 1, non_lus: 0 });
    api.mesCandidatures.mockRejectedValue(new Error("réseau"));
    await ouvrir("/messages", [{ path: "/messages", Component: MessagesList }]);
    const carte = conteneur.querySelector('a[href="/messages/M1"]')!;
    expect(carte.textContent).toContain("Appartement lumineux");
    expect(carte.textContent).not.toMatch(/Acceptée|En attente/);
  });
});

describe("ConversationPage", () => {
  const fil = (extra: Partial<Conversation> = {}) =>
    ({
      id: "c1",
      match_id: "M1",
      listing: { ...ANNONCE, quartier: "Kipé" },
      interlocuteur: PROPRIETAIRE,
      ecriture_fermee: false,
      motif_fermeture: null,
      messages: [
        { id: "m1", sender_id: "moi", contenu: "Toujours disponible ?", lu: true, created_at: "2026-10-31T10:31:00" },
        { id: "m2", sender_id: "autre", contenu: "Oui, samedi 10 h.", lu: false, created_at: "2026-10-31T10:42:00" },
      ],
      pagination: { limite: 30, plus_anciens: false, curseur: null },
      ...extra,
    }) as unknown as Conversation;

  const ouvrirFil = () => ouvrir("/messages/M1", [{ path: "/messages/:matchId", Component: ConversationPage }]);

  it("en-tête : titre de l'annonce et rôle de l'interlocuteur ; « Lu » sur mes messages lus", async () => {
    api.filParMatch.mockResolvedValue(fil());
    await ouvrirFil();
    const entete = conteneur.querySelector("header")!;
    expect(entete.textContent).toContain("Appartement lumineux");
    expect(entete.textContent).toContain("Propriétaire · Ibrahima Sow");
    expect(entete.querySelector('a[aria-label="Voir l\'annonce"]')?.getAttribute("href")).toBe("/listing/a1");
    expect(conteneur.textContent).toContain("Toujours disponible ?");
    expect(conteneur.textContent).toMatch(/10:31 · Lu/);
    expect(conteneur.textContent).not.toMatch(/10:42 · Lu/);
    expect(conteneur.querySelector('[aria-label="Messages types"]')?.textContent).toContain("Merci, à samedi !");
    expect(conteneur.querySelector('button[aria-label="Joindre une photo"]')).toBeNull();
  });

  it("visite planifiée : sa date et son heure, sans bouton « Confirmer »", async () => {
    api.filParMatch.mockResolvedValue(fil());
    api.detailMatch.mockResolvedValue({ id: "M1", status: "accepted", visite_date: "2026-11-07T10:00:00" });
    await ouvrirFil();
    expect(conteneur.textContent).toContain("Visite planifiée");
    expect(conteneur.textContent).toMatch(/Samedi 7 nov\.? · 10:00/);
    expect([...conteneur.querySelectorAll("button")].some((b) => b.textContent === "Confirmer")).toBe(false);
  });

  it("discussion fermée : le bandeau de fermeture, pas celui de la mise en relation", async () => {
    api.filParMatch.mockResolvedValue(fil({ ecriture_fermee: true, motif_fermeture: "candidature_refusee" }));
    await ouvrirFil();
    expect(conteneur.textContent).toContain("La candidature a été refusée");
    expect(conteneur.textContent).not.toContain("Mise en relation validée");
  });
});

describe("TenantProfile", () => {
  const passeport = {
    score: 72,
    situation_pro: "salarié",
    a_un_garant: false,
    documents: { cni_recto: false, cni_verso: false, passport: false, income: false },
    income_verified: true,
    etapes: [],
    abonnement: { actif: false, jusqu_au: null },
  };

  it("en-tête : nom, barre des niveaux ; onglets en segment ; pièces en cartes ; avis sans « Ajouter »", async () => {
    session.user = { ...LOCATAIRE, trust_level: 3, cni_verified: true } as User;
    api.passeport.mockResolvedValue(passeport);
    await ouvrir("/tenant/profile", [{ path: "/tenant/profile", Component: TenantProfile }]);

    expect(conteneur.querySelector("header")?.textContent).toContain("Aminata Diallo");
    expect(conteneur.querySelector('[aria-label="Niveau 3 sur 4"]')).not.toBeNull();
    const onglets = [
      ...conteneur.querySelectorAll('[role="radiogroup"][aria-label="Sections du profil"] [role="radio"]'),
    ];
    expect(onglets.map((o) => o.textContent)).toEqual(["Dossier", "Ma recherche", "Compte"]);

    expect(conteneur.textContent).toContain("Téléphone");
    expect(conteneur.textContent).toContain("Vérifié par SMS");
    expect(conteneur.textContent).toContain("Justificatif de revenus");
    const avis = [...conteneur.querySelectorAll("p")].find((p) => p.textContent === "Avis d'un ancien bailleur")!;
    const carteAvis = avis.closest("div")!.parentElement!;
    expect(carteAvis.textContent).toContain("Pour passer Recommandé");
    expect(carteAvis.querySelector("button, label")).toBeNull();

    await act(async () => (onglets[2] as HTMLButtonElement).click());
    expect(onglets[2].getAttribute("aria-checked")).toBe("true");
    expect(conteneur.textContent).toContain("Informations du compte");
  });
});

describe("OwnerProfile", () => {
  it("même en-tête partagé : nom, rôle, badge ; cloche des notifications", async () => {
    session.user = { ...PROPRIETAIRE, id: "u2", trust_level: 2, phone_verified: true } as User;
    await ouvrir("/owner/profile", [{ path: "/owner/profile", Component: OwnerProfile }]);
    const entete = conteneur.querySelector("header")!;
    expect(entete.querySelector("h1")?.textContent).toBe("Mon profil");
    expect(entete.textContent).toContain("Ibrahima Sow");
    expect(entete.textContent).toContain("Propriétaire");
    expect(entete.querySelector('a[href="/notifications"]')).not.toBeNull();
  });
});

describe("Layout, navigation du bas", () => {
  it("cinq onglets, l'actif annoncé, badge des messages non lus", async () => {
    await ouvrir("/tenant/dashboard", [
      { element: <Layout />, children: [{ path: "/tenant/dashboard", element: <Outlet /> }] },
    ]);
    const nav = conteneur.querySelector('nav[aria-label="Navigation principale"]')!;
    const onglets = [...nav.querySelectorAll("a")];
    expect(onglets.map((a) => a.textContent?.replace(/\d+ non lus/, "").trim())).toEqual([
      "Accueil",
      "Annonces",
      "Candidatures",
      "Messages",
      "Profil",
    ]);
    expect(onglets[0].getAttribute("aria-current")).toBe("page");
    expect(onglets[1].hasAttribute("aria-current")).toBe(false);
    expect(onglets[3].textContent).toContain("3 non lus");
  });
});
