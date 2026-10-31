import { afterEach, describe, expect, it, vi } from "vitest";

import { CLE_PRESENTATION, marquerPresentationVue, presentationVue } from "./presentation";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("presentation", () => {
  it("non vue au départ, vue une fois marquée", () => {
    expect(presentationVue()).toBe(false);
    marquerPresentationVue();
    expect(localStorage.getItem(CLE_PRESENTATION)).toBe("1");
    expect(presentationVue()).toBe(true);
  });

  it("stockage illisible : la présentation est considérée comme non vue", () => {
    localStorage.setItem(CLE_PRESENTATION, "1");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(presentationVue()).toBe(false);
  });

  it("écriture impossible : aucune exception", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(() => marquerPresentationVue()).not.toThrow();
  });
});
