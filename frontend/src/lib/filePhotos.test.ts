/** File d'envoi des photos : séquentielle, sans reprise automatique. */
import { describe, expect, it, vi } from "vitest";

import { ApiError, MESSAGE_RESEAU } from "../api/client";
import { FilePhotos, resumer, type DependancesFile } from "./filePhotos";

function photo(nom: string) {
  return new File([new Uint8Array(10)], nom, { type: "image/jpeg" });
}

/** Dépendances simulées ; `echecs` liste les noms dont le prochain envoi échoue. */
function fabriquer(echecs: Map<string, unknown> = new Map()) {
  let enVol = 0;
  let maxEnVol = 0;
  const serveur: string[] = [];
  const envoyer = vi.fn<DependancesFile["envoyer"]>(async (_id, fichier, { onProgression }) => {
    enVol += 1;
    maxEnVol = Math.max(maxEnVol, enVol);
    await new Promise((r) => setTimeout(r, 1));
    onProgression(0.5);
    await new Promise((r) => setTimeout(r, 1));
    enVol -= 1;
    const echec = echecs.get(fichier.name);
    if (echec) {
      echecs.delete(fichier.name); // n'échoue qu'une fois
      throw echec;
    }
    serveur.push(fichier.name);
    return { images: [...serveur] };
  });
  const file = new FilePhotos({
    compresser: async (f) => new File([f], f.name.replace(/\.\w+$/, ".webp"), { type: "image/webp" }),
    originalEnvoyable: (f) => f.name.endsWith(".jpg"),
    envoyer,
    creerApercu: (f) => `blob:${(f as File).name}`,
    revoquerApercu: vi.fn(),
  });
  const images = vi.fn();
  file.definirRappel(images);
  return { file, envoyer, images, serveur, maxEnVol: () => maxEnVol };
}

describe("FilePhotos", () => {
  it("compresse et retient les photos tant que l'annonce n'existe pas", async () => {
    const { file, envoyer } = fabriquer();

    await file.ajouter([photo("a.jpg"), photo("b.jpg")]);

    expect(envoyer).not.toHaveBeenCalled();
    expect(file.getSnapshot().photos.map((p) => [p.nom, p.etat, p.apercu])).toEqual([
      ["a.webp", "attente", "blob:a.webp"],
      ["b.webp", "attente", "blob:b.webp"],
    ]);
  });

  it("envoie une photo à la fois, dans l'ordre, puis Réessayer reprend l'échec", async () => {
    const { file, envoyer, images, serveur, maxEnVol } = fabriquer(
      new Map([["b.webp", new ApiError(MESSAGE_RESEAU, 0)]]),
    );
    await file.ajouter([photo("a.jpg"), photo("b.jpg"), photo("c.jpg")]);

    await file.demarrer("annonce-1");

    // Séquentiel : jamais deux envois simultanés, ordre conservé.
    expect(maxEnVol()).toBe(1);
    expect(envoyer.mock.calls.map(([id, f]) => [id, f.name])).toEqual([
      ["annonce-1", "a.webp"],
      ["annonce-1", "b.webp"],
      ["annonce-1", "c.webp"],
    ]);
    // L'échec ne bloque pas la suite et n'est pas rejoué automatiquement.
    expect(serveur).toEqual(["a.webp", "c.webp"]);
    const restantes = file.getSnapshot().photos;
    expect(restantes).toHaveLength(1);
    expect(restantes[0]).toMatchObject({ nom: "b.webp", etat: "erreur", erreur: MESSAGE_RESEAU });
    expect(resumer(file.getSnapshot())).toMatchObject({ envoyees: 2, enEchec: 1, restantes: 0 });

    await file.reessayer(restantes[0].id);

    expect(envoyer).toHaveBeenCalledTimes(4);
    expect(serveur).toEqual(["a.webp", "c.webp", "b.webp"]);
    expect(file.getSnapshot().photos).toEqual([]);
    expect(resumer(file.getSnapshot())).toMatchObject({ envoyees: 3, enEchec: 0 });
    expect(images).toHaveBeenLastCalledWith(["a.webp", "c.webp", "b.webp"]);
  });

  it("une photo ajoutée pendant un envoi passe après, sans envoi parallèle", async () => {
    const { file, serveur, maxEnVol } = fabriquer();
    await file.demarrer("annonce-1");

    const premiere = file.ajouter([photo("a.jpg")]);
    await new Promise((r) => setTimeout(r, 0));
    void file.ajouter([photo("b.jpg")]);
    await premiere;
    await file.traiter();

    expect(serveur).toEqual(["a.webp", "b.webp"]);
    expect(maxEnVol()).toBe(1);
  });

  it("traduit un 413 en message clair", async () => {
    const { file } = fabriquer(new Map([["a.webp", new ApiError("Erreur 413", 413)]]));
    await file.ajouter([photo("a.jpg")]);
    await file.demarrer("annonce-1");

    expect(file.getSnapshot().photos[0].erreur).toBe("Photo trop lourde pour le serveur.");
  });

  it("envoie l'original si la compression échoue et qu'il est acceptable", async () => {
    const { file, serveur } = fabriquer();
    const compresser = vi.fn().mockRejectedValue(new Error("décodage impossible"));
    // @ts-expect-error -- remplacement ciblé de la dépendance pour ce test
    file.deps.compresser = compresser;

    await file.ajouter([photo("a.jpg")]);
    await file.demarrer("annonce-1");

    expect(serveur).toEqual(["a.jpg"]);
    // Signalée : l'original garde ses métadonnées EXIF (GPS).
    expect(resumer(file.getSnapshot()).nonCompressees).toBe(1);
  });

  it("l'envoi est « actif » (confirmation avant de quitter) tant que la file tourne", async () => {
    const { file } = fabriquer(new Map([["a.webp", new ApiError(MESSAGE_RESEAU, 0)]]));
    await file.ajouter([photo("a.jpg")]);
    // Création pas encore enregistrée : rien ne serait perdu côté serveur.
    expect(resumer(file.getSnapshot()).envoiActif).toBe(false);

    const envoi = file.demarrer("annonce-1");
    expect(resumer(file.getSnapshot()).envoiActif).toBe(true);
    await envoi;
    // Échec affiché : plus rien ne tourne.
    expect(resumer(file.getSnapshot()).envoiActif).toBe(false);
  });

  it("signale un format illisible, sans proposer de réessayer", async () => {
    const { file, envoyer } = fabriquer();
    // @ts-expect-error -- remplacement ciblé de la dépendance pour ce test
    file.deps.compresser = vi.fn().mockRejectedValue(new Error("HEIC"));

    await file.ajouter([photo("maison.heic")]);
    await file.demarrer("annonce-1");

    expect(envoyer).not.toHaveBeenCalled();
    expect(file.getSnapshot().photos[0]).toMatchObject({ etat: "erreur", reessayable: false });
    expect(file.getSnapshot().photos[0].erreur).toMatch(/Format de photo non pris en charge/);
  });

  it("retirer libère l'aperçu ; arrêter remet l'envoi en cours en attente", async () => {
    const { file } = fabriquer();
    await file.ajouter([photo("a.jpg"), photo("b.jpg")]);
    const [a] = file.getSnapshot().photos;

    file.retirer(a.id);
    expect(file.getSnapshot().photos.map((p) => p.nom)).toEqual(["b.webp"]);

    // Un envoi qui obéit à l'annulation.
    // @ts-expect-error -- remplacement ciblé de la dépendance pour ce test
    file.deps.envoyer = (_id: string, _f: File, { signal }: { signal: AbortSignal }) =>
      new Promise((_r, rejeter) =>
        signal.addEventListener("abort", () => rejeter(new DOMException("annulé", "AbortError"))),
      );
    const envoi = file.demarrer("annonce-1");
    await new Promise((r) => setTimeout(r, 0));
    expect(file.getSnapshot().photos[0].etat).toBe("envoi");
    file.arreter();
    await envoi;

    expect(file.getSnapshot().photos[0]).toMatchObject({ etat: "attente", progression: 0 });
  });
});
