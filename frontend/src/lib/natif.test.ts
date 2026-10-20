import { beforeEach, describe, expect, it, vi } from "vitest";

const natif = vi.hoisted(() => ({ actif: false }));
const app = vi.hoisted(() => ({
  ecouteur: null as null | ((e: { canGoBack: boolean }) => void),
  exitApp: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => natif.actif },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_nom: string, ecouteur: (e: { canGoBack: boolean }) => void) => {
      app.ecouteur = ecouteur;
      return { remove: vi.fn() };
    }),
    exitApp: app.exitApp,
  },
}));

const { initialiserNatif } = await import("./natif");
const { App } = await import("@capacitor/app");

describe("initialiserNatif", () => {
  beforeEach(() => {
    app.ecouteur = null;
    app.exitApp.mockReset();
    vi.mocked(App.addListener).mockClear();
  });

  it("ne fait rien sur le site web", async () => {
    natif.actif = false;
    await initialiserNatif();
    expect(App.addListener).not.toHaveBeenCalled();
  });

  it("dans l'appli, le bouton retour revient à la page précédente", async () => {
    natif.actif = true;
    const retour = vi.spyOn(window.history, "back").mockImplementation(() => {});
    await initialiserNatif();

    expect(App.addListener).toHaveBeenCalledWith("backButton", expect.any(Function));
    app.ecouteur!({ canGoBack: true });
    expect(retour).toHaveBeenCalledOnce();
    expect(app.exitApp).not.toHaveBeenCalled();
  });

  it("dans l'appli, sans page précédente, le bouton retour quitte l'appli", async () => {
    natif.actif = true;
    const retour = vi.spyOn(window.history, "back").mockImplementation(() => {});
    await initialiserNatif();

    app.ecouteur!({ canGoBack: false });
    expect(app.exitApp).toHaveBeenCalledOnce();
    expect(retour).not.toHaveBeenCalled();
  });
});
