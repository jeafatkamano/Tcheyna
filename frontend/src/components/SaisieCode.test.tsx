/**
 * Code en six cases (lot 3.14) : avance automatique, retour arrière, collage,
 * code proposé par Android dans la première case.
 */
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { SaisieCode } from "./SaisieCode";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: ReturnType<typeof createRoot> | null = null;
let valeur = "";

function Banc() {
  const [code, setCode] = useState("");
  return (
    <SaisieCode
      valeur={code}
      onChange={(suivant) => {
        valeur = suivant;
        setCode(suivant);
      }}
    />
  );
}

afterEach(() => {
  act(() => racine?.unmount());
  racine = null;
  valeur = "";
  document.body.innerHTML = "";
});

function ouvrir() {
  const conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine!.render(<Banc />));
  return [...conteneur.querySelectorAll("input")];
}

function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, texte);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function touche(el: HTMLInputElement, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function coller(el: HTMLInputElement, texte: string) {
  const evenement = new Event("paste", { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: () => string };
  };
  evenement.clipboardData = { getData: () => texte };
  act(() => {
    el.dispatchEvent(evenement);
  });
}

describe("SaisieCode", () => {
  it("six cases étiquetées ; la première propose le code reçu par SMS", () => {
    const cases = ouvrir();
    expect(cases).toHaveLength(6);
    expect(cases[0].getAttribute("autocomplete")).toBe("one-time-code");
    expect(cases[1].getAttribute("autocomplete")).toBe("off");
    expect(cases[0].getAttribute("inputmode")).toBe("numeric");
    expect(cases[2].getAttribute("aria-label")).toBe("Chiffre 3 sur 6");
    expect(cases[0].id).toBe("code");
  });

  it("chaque chiffre tapé avance à la case suivante ; les lettres sont ignorées", () => {
    const cases = ouvrir();
    taper(cases[0], "4");
    expect(valeur).toBe("4");
    expect(document.activeElement).toBe(cases[1]);
    taper(cases[1], "a");
    expect(valeur).toBe("4");
    taper(cases[1], "8");
    taper(cases[2], "1");
    expect(valeur).toBe("481");
    expect(document.activeElement).toBe(cases[3]);
  });

  it("retour arrière dans une case vide efface la précédente et y revient", () => {
    const cases = ouvrir();
    taper(cases[0], "4");
    taper(cases[1], "8");
    touche(cases[2], "Backspace");
    expect(valeur).toBe("4");
    expect(document.activeElement).toBe(cases[1]);
  });

  it("vider une case remplie retire son chiffre", () => {
    const cases = ouvrir();
    taper(cases[0], "4");
    taper(cases[1], "8");
    taper(cases[1], "");
    expect(valeur).toBe("4");
  });

  it("un code collé se répartit dans les cases, sans les caractères parasites", () => {
    const cases = ouvrir();
    coller(cases[0], " 123-456 ");
    expect(valeur).toBe("123456");
    expect(cases.map((c) => c.value).join("")).toBe("123456");
    expect(document.activeElement).toBe(cases[5]);
  });

  it("le code proposé par Android dans la première case remplit les six cases", () => {
    const cases = ouvrir();
    taper(cases[0], "987654");
    expect(valeur).toBe("987654");
  });

  it("une case vide au-delà de la saisie renvoie le focus à la première case libre", () => {
    const cases = ouvrir();
    taper(cases[0], "4");
    act(() => cases[4].focus());
    expect(document.activeElement).toBe(cases[1]);
  });
});
