import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { PhotoAnnonce } from "../components/PhotoAnnonce";
import { attributsPhoto, IMAGE_REPLI, TAILLES_CARTE } from "./imageRepli";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("attributsPhoto", () => {
  it("vraie photo : une seule taille, sans srcset", () => {
    expect(attributsPhoto("https://x.supabase.co/a.webp", TAILLES_CARTE)).toEqual({
      src: "https://x.supabase.co/a.webp",
    });
  });

  it("sans photo : image locale avec srcset 256w/512w, jamais Unsplash", () => {
    const attributs = attributsPhoto(undefined, TAILLES_CARTE);
    expect(attributs.srcSet).toMatch(/ 256w, .* 512w$/);
    expect(attributs.sizes).toBe(TAILLES_CARTE);
    expect(attributs.src).not.toContain("unsplash");
  });
});

describe("PhotoAnnonce", () => {
  let racine: ReturnType<typeof createRoot> | null = null;
  let conteneur: HTMLDivElement;

  afterEach(() => {
    act(() => racine?.unmount());
    racine = null;
    conteneur.remove();
  });

  function afficher(url: string | undefined) {
    act(() => racine!.render(<PhotoAnnonce url={url} tailles={TAILLES_CARTE} alt="" />));
    return conteneur.querySelector("img")!;
  }

  it("bascule sur le repli en cas d'échec, puis affiche une nouvelle photo", () => {
    conteneur = document.createElement("div");
    document.body.appendChild(conteneur);
    racine = createRoot(conteneur);

    let img = afficher("https://x.supabase.co/introuvable.webp");
    expect(img.getAttribute("srcset")).toBeNull();

    act(() => img.dispatchEvent(new Event("error")));
    img = conteneur.querySelector("img")!;
    expect(img.getAttribute("srcset")).toBe(IMAGE_REPLI.srcSet);

    // Même nœud, nouvelle photo : plus de srcset qui la masquerait.
    img = afficher("https://x.supabase.co/nouvelle.webp");
    expect(img.getAttribute("src")).toBe("https://x.supabase.co/nouvelle.webp");
    expect(img.getAttribute("srcset")).toBeNull();
  });
});
