/**
 * Rappel de visite (lot 2.7) : icône dédiée, et le lien ouvre la conversation
 * (le paramètre `?visite=`, clé de dédoublonnage côté serveur, est ignoré).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";
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

function Conversation() {
  const { matchId } = useParams();
  return <p>conversation {matchId}</p>;
}

describe("NotificationsPage — rappel de visite", () => {
  it("montre l'icône du rappel et ouvre la conversation", async () => {
    liste.mockResolvedValue({
      notifications: [
        {
          id: "N1",
          type: "rappel_visite",
          titre: "Rappel : visite demain",
          contenu: "Visite de « Appartement Kipé » demain, le 15/11/2026 à 14:30, avec Awa.",
          lien: "/messages/M1?visite=2026-11-15T14:30",
          lu: false,
          created_at: "2026-11-14T03:00:00",
        },
      ],
      non_lues: 1,
    });
    marquerLue.mockResolvedValue({ message: "ok" });

    const router = createMemoryRouter(
      [
        { path: "/notifications", Component: NotificationsPage },
        { path: "/messages/:matchId", Component: Conversation },
      ],
      { initialEntries: ["/notifications"] },
    );
    const conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);
    await act(async () => racine!.render(<RouterProvider router={router} />));

    expect(conteneur.textContent).toContain("Rappel : visite demain");
    expect(conteneur.querySelector("svg.lucide-calendar-clock")).not.toBeNull();
    expect(conteneur.querySelector("svg.lucide-bell")).toBeNull(); // pas l'icône par défaut

    const carte = [...conteneur.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Rappel : visite demain"),
    )!;
    await act(async () => carte.click());

    expect(marquerLue).toHaveBeenCalledWith("N1");
    expect(router.state.location.pathname).toBe("/messages/M1");
    expect(router.state.location.search).toBe("?visite=2026-11-15T14:30");
    expect(conteneur.textContent).toContain("conversation M1");
  });
});
