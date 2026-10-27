/**
 * Expiration sans activité (D6, lot 2.3) : icônes de la relance et du
 * retrait, et le lien ouvre l'annonce dans l'espace propriétaire (avec
 * l'échéance, que la page lit pour son bandeau).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

const liste = vi.fn();
const marquerLue = vi.fn();

vi.mock("../api", async (original) => {
  const reel = await original<typeof import("../api")>();
  return { ...reel, notificationsAPI: { ...reel.notificationsAPI, liste, marquerLue } };
});

const { NotificationsPage } = await import("./NotificationsPage");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  document.body.innerHTML = "";
});

describe("NotificationsPage — expiration d'une annonce", () => {
  it("icônes de la relance et du retrait, lien vers l'annonce", async () => {
    liste.mockResolvedValue({
      notifications: [
        {
          id: "N1",
          type: "annonce_bientot_expiree",
          titre: "Votre annonce est-elle toujours d'actualité ?",
          contenu: "Sans nouvelle activité, « Appartement Kipé » sera retirée…",
          lien: "/owner/listings/L1?echeance=2026-11-21",
          lu: false,
          created_at: "2026-11-14T03:00:00",
        },
        {
          id: "N2",
          type: "annonce_expiree",
          titre: "Annonce retirée faute d'activité",
          contenu: "« Villa Lambanyi » était sans activité…",
          lien: "/owner/listings/L2",
          lu: true,
          created_at: "2026-11-10T03:00:00",
        },
      ],
      non_lues: 1,
    });
    marquerLue.mockResolvedValue({ message: "ok" });

    const router = createMemoryRouter(
      [
        { path: "/notifications", Component: NotificationsPage },
        { path: "/owner/listings/:id", element: <p>annonce</p> },
      ],
      { initialEntries: ["/notifications"] },
    );
    const conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    await act(async () => racine!.render(<RouterProvider router={router} />));

    expect(conteneur.querySelector("svg.lucide-hourglass")).not.toBeNull();
    expect(conteneur.querySelector("svg.lucide-eye-off")).not.toBeNull();
    // Aucune des deux ne retombe sur l'icône par défaut.
    expect(conteneur.querySelector("svg.lucide-bell")).toBeNull();

    const carte = [...conteneur.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("toujours d'actualité"),
    )!;
    await act(async () => carte.click());

    expect(marquerLue).toHaveBeenCalledWith("N1");
    expect(router.state.location.pathname).toBe("/owner/listings/L1");
    expect(router.state.location.search).toBe("?echeance=2026-11-21");
  });
});
