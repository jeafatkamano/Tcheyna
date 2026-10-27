/**
 * OwnerListingForm.tsx — Création et gestion d'une annonce.
 *
 * En édition, la page porte aussi le parcours de certification : dépôt du
 * document de propriété, demande, et suivi de la décision.
 *
 * Publier exige un téléphone vérifié (D3) : la page le signale avant la
 * saisie et, si le serveur refuse quand même (403 « telephone_non_verifie »),
 * propose la vérification sur place, sans perdre le brouillon.
 */
import { ArrowLeft, ArrowRight, Check, EyeOff, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  ApiError,
  listingsAPI,
  type DonneesAnnonce,
  type Listing,
  type TypeTransaction,
} from "../../api";
import { Chargement, Erreur, MessageErreur, MessageSucces } from "../../components/Etats";
import { ModalePaiement } from "../../components/ModalePaiement";
import {
  ConfirmationRetrait,
  EtatResoumission,
  RemiseEnLigne,
} from "../../components/CycleAnnonce";
import { TeleversementDocuments } from "../../components/TeleversementDocuments";
import { TeleversementPhotos } from "../../components/TeleversementPhotos";
import {
  BandeauTelephoneAVerifier,
  CODE_TELEPHONE_NON_VERIFIE,
} from "../../components/VerificationPublication";
import { useAuth } from "../../context/AuthContext";
import { useAction, useApi } from "../../hooks/useApi";
import { useFilePhotos } from "../../hooks/useFilePhotos";
import { resumer } from "../../lib/filePhotos";
import { useGeo } from "../../hooks/useGeo";
import { formatMontant, sansPieces } from "../../lib/format";
import { ConfirmationActualite } from "../../components/ConfirmationActualite";

/** Frais de certification, alignés sur la grille tarifaire du serveur. */
const PRIX_CERTIFICATION = 250_000;

const EQUIPEMENTS = [
  { cle: "has_generator", label: "Groupe électrogène" },
  { cle: "has_water", label: "Eau courante" },
  { cle: "has_wifi", label: "WiFi" },
  { cle: "is_secured", label: "Gardien / clôture" },
  { cle: "has_parking", label: "Parking" },
  { cle: "has_ac", label: "Climatisation" },
] as const;

const CHAMP = "w-full px-4 py-3 rounded-xl outline-none";
const STYLE_CHAMP = { background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" };

type Formulaire = {
  title_fr: string;
  description_fr: string;
  ville: string;
  quartier: string;
  adresse: string;
  type_transaction: TypeTransaction;
  type_bien: string;
  prix: string;
  charges: string;
  caution: string;
  nb_pieces: string;
  superficie: string;
  etage: string;
  meuble: boolean;
  disponible_a_partir: string;
  has_generator: boolean;
  has_water: boolean;
  has_wifi: boolean;
  is_secured: boolean;
  has_parking: boolean;
  has_ac: boolean;
};

const VIDE: Formulaire = {
  title_fr: "",
  description_fr: "",
  ville: "Conakry",
  quartier: "",
  adresse: "",
  type_transaction: "location",
  type_bien: "appartement",
  prix: "",
  charges: "",
  caution: "",
  nb_pieces: "1",
  superficie: "",
  etage: "",
  meuble: false,
  disponible_a_partir: "",
  has_generator: false,
  has_water: false,
  has_wifi: false,
  is_secured: false,
  has_parking: false,
  has_ac: false,
};

export function OwnerListingForm() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const enEdition = Boolean(id);

  const annonce = useApi(() => listingsAPI.detail(id!), [id], { actif: enEdition });

  if (enEdition && annonce.chargement) return <Chargement texte="Chargement de l'annonce…" />;
  if (enEdition && (annonce.erreur || !annonce.data)) {
    return <Erreur message={annonce.erreur ?? "Annonce introuvable"} onReessayer={annonce.recharger} />;
  }

  return (
    <Formulaire
      key={annonce.data?.id ?? "nouveau"}
      existante={annonce.data ?? null}
      onSauvegarde={(listing) => {
        if (!enEdition) navigate(`/owner/listings/${listing.id}`, { replace: true });
        else void annonce.recharger();
      }}
      // Retrait réversible (lot 2.2) : on reste sur l'annonce, qui propose
      // alors sa remise en ligne.
      onRetrait={() => void annonce.recharger()}
    />
  );
}

function Formulaire({
  existante,
  onSauvegarde,
  onRetrait,
}: {
  existante: Listing | null;
  onSauvegarde: (listing: Listing) => void;
  onRetrait: () => void;
}) {
  const geo = useGeo("Guinée", "Conakry");
  const { user } = useAuth();
  // Vérifié depuis cette page : le bandeau s'efface même si le rafraîchissement
  // de l'utilisateur échoue (réseau), le serveur tranchera à la publication.
  const [telephoneVerifieIci, setTelephoneVerifieIci] = useState(false);
  const [succes, setSucces] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>(existante?.images ?? []);
  // En création, l'annonce n'a pas encore d'identifiant : les photos sont
  // compressées et retenues dans cette file, puis envoyées juste après
  // l'enregistrement. Le formulaire reste affiché tant qu'elles partent.
  const photos = useFilePhotos(setImages);
  // Annonce créée depuis cette page : on y reste le temps d'envoyer les
  // photos, et une nouvelle soumission devient une modification.
  const [creee, setCreee] = useState<Listing | null>(null);
  const courante = existante ?? creee;
  // Faux après démontage : un envoi qui se termine ensuite ne doit plus
  // ramener l'utilisateur, parti ailleurs, sur la page de l'annonce.
  const monte = useRef(false);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  const [form, setForm] = useState<Formulaire>(
    existante
      ? {
          title_fr: existante.title,
          description_fr: existante.description,
          ville: existante.ville,
          quartier: existante.quartier ?? "",
          adresse: existante.adresse ?? "",
          type_transaction: existante.type_transaction ?? "location",
          type_bien: existante.type_bien,
          prix: String(existante.prix),
          charges: String(existante.charges ?? ""),
          caution: existante.caution != null ? String(existante.caution) : "",
          nb_pieces: existante.nb_pieces != null ? String(existante.nb_pieces) : "1",
          superficie: existante.superficie != null ? String(existante.superficie) : "",
          etage: existante.etage != null ? String(existante.etage) : "",
          meuble: existante.meuble,
          disponible_a_partir: existante.disponible_a_partir ?? "",
          has_generator: existante.equipements.generateur,
          has_water: existante.equipements.eau,
          has_wifi: existante.equipements.wifi,
          is_secured: existante.equipements.securite,
          has_parking: existante.equipements.parking,
          has_ac: existante.equipements.climatisation,
        }
      : VIDE,
  );

  const creation = useAction(listingsAPI.creer);
  const modification = useAction(listingsAPI.modifier);
  const retrait = useAction(listingsAPI.retirer);

  const enCours = creation.enCours || modification.enCours || (Boolean(creee) && photos.resume.occupee);
  // Refus « téléphone non vérifié » : relayé par son propre bandeau, avec la
  // vérification, plutôt que par le message d'erreur générique.
  const refusTelephone = creation.code === CODE_TELEPHONE_NON_VERIFIE;
  const erreur = (refusTelephone ? null : creation.erreur) ?? modification.erreur ?? retrait.erreur;
  // Un seul bandeau, toujours au même endroit : l'avertissement préalable
  // devient le refus (rôle et texte changent), sans démonter une
  // vérification déjà commencée (numéro saisi, code attendu).
  const bandeauTelephone =
    !courante &&
    (refusTelephone ||
      (!telephoneVerifieIci &&
        (user?.role === "landlord" || user?.role === "agency") &&
        !user.phone_verified));
  const bandeauRef = useRef<HTMLDivElement>(null);
  const publierRef = useRef<HTMLButtonElement>(null);

  // Refus reçu en bas du formulaire : on amène l'utilisateur au bandeau.
  useEffect(() => {
    if (!refusTelephone) return;
    bandeauRef.current?.scrollIntoView?.({ block: "center" });
    bandeauRef.current?.focus();
  }, [refusTelephone]);

  function apresVerificationTelephone() {
    setTelephoneVerifieIci(true);
    creation.reinitialiserErreur();
    confirmer("Numéro vérifié : vous pouvez publier votre annonce.");
    // Le bandeau va quitter la page : le focus ne doit pas retomber sur
    // <body>. Il va au bouton « Publier », toujours affiché.
    publierRef.current?.scrollIntoView?.({ block: "center" });
    publierRef.current?.focus();
  }

  function confirmer(message: string) {
    setSucces(message);
    setTimeout(() => setSucces(null), 3000);
  }

  function donnees(): DonneesAnnonce {
    return {
      title_fr: form.title_fr.trim(),
      description_fr: form.description_fr.trim(),
      pays: "Guinée",
      ville: form.ville,
      quartier: form.quartier || undefined,
      adresse: form.adresse || undefined,
      type_transaction: form.type_transaction,
      type_bien: form.type_bien,
      prix: Number(form.prix),
      // Le serveur les remet à zéro pour une vente ; on évite de les envoyer.
      charges: estVente ? 0 : form.charges ? Number(form.charges) : 0,
      caution: estVente || !form.caution ? undefined : Number(form.caution),
      nb_pieces: bienSansPieces ? undefined : Number(form.nb_pieces) || 1,
      superficie: form.superficie ? Number(form.superficie) : undefined,
      etage: bienSansPieces || !form.etage ? undefined : Number(form.etage),
      meuble: bienSansPieces ? false : form.meuble,
      disponible_a_partir: form.disponible_a_partir || undefined,
      has_generator: form.has_generator,
      has_water: form.has_water,
      has_wifi: form.has_wifi,
      is_secured: form.is_secured,
      has_parking: form.has_parking,
      has_ac: form.has_ac,
    };
  }

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    const reponse = courante
      ? await modification.executer(courante.id, donnees())
      : await creation.executer(donnees());
    if (!reponse || !monte.current) return;

    if (existante) {
      confirmer("Annonce mise à jour");
      onSauvegarde(reponse.listing);
      return;
    }

    // Création : les photos choisies avant partent maintenant que l'annonce
    // possède un identifiant. On ne change de page qu'une fois toutes
    // envoyées ; sinon l'utilisateur reste ici, voit les échecs et peut
    // réessayer (changer d'URL démonterait le formulaire et sa file).
    setCreee(reponse.listing);
    if (photos.etat.photos.length) {
      await photos.file.demarrer(reponse.listing.id);
      if (!monte.current || photos.file.estArretee()) return;
      const bilan = resumer(photos.file.getSnapshot());
      if (bilan.enEchec > 0 || bilan.restantes > 0) return; // reprise manuelle
    }

    confirmer("Annonce publiée");
    onSauvegarde(reponse.listing);
  }

  /** Après « Réessayer » en création : tout est parti, on va sur l'annonce. */
  function apresReprise() {
    if (!creee || existante || !monte.current || photos.file.estArretee()) return;
    const bilan = resumer(photos.file.getSnapshot());
    if (bilan.enEchec > 0 || bilan.restantes > 0) return;
    confirmer("Annonce publiée");
    onSauvegarde(creee);
  }

  // Bandeau de création, dérivé de la file : il disparaît de lui-même quand
  // les photos manquantes finissent par partir.
  const messageCreation =
    creee && !existante
      ? photos.resume.envoiActif
        ? "Annonce publiée. Envoi des photos en cours…"
        : photos.resume.enEchec > 0
          ? "Annonce publiée. Certaines photos restent à envoyer."
          : null
      : null;

  // Retrait confirmé sur place : le texte dit ce qu'il change (recherche,
  // candidatures) avant que le bailleur ne s'engage.
  const [confirmationRetrait, setConfirmationRetrait] = useState(false);

  async function retirer() {
    if (!existante) return;
    const reponse = await retrait.executer(existante.id);
    if (!reponse || !monte.current) return;
    setConfirmationRetrait(false);
    confirmer(reponse.message);
    onRetrait();
  }

  const estVente = form.type_transaction === "vente";
  const bienSansPieces = sansPieces(form.type_bien);
  const coutEntree =
    (Number(form.prix) || 0) + (Number(form.charges) || 0) + (Number(form.caution) || 0);

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-5" style={{ background: "#1E3A5F" }}>
        <div className="flex items-center gap-3">
          <Link to="/owner/listings" className="p-2 -ml-2 rounded-lg text-white/70 hover:text-white">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-white font-bold" style={{ fontSize: "19px" }}>
            {courante ? "Modifier l'annonce" : "Publier une annonce"}
          </h1>
        </div>
      </div>

      {/* « Toujours d'actualité ? » (D6, lot 2.3), en haut de la page pour la
          relance, hors du <form> : confirmer n'enregistre pas l'annonce. */}
      {existante && (
        <ConfirmationActualite
          listing={existante}
          onPerimee={() => onSauvegarde(existante)}
          className="px-4 pt-5"
        />
      )}

      <div className="px-4 pt-5 space-y-5">
        {/* Annonce retirée : hors du <form>, la vérification du téléphone
            que la remise en ligne peut ouvrir ne doit pas le soumettre. */}
        {existante?.retiree && (
          <section
            className="rounded-2xl p-5 space-y-3"
            style={{ background: "#F8FAFC", border: "1.5px solid #E2E8F0" }}
          >
            <div className="flex items-center gap-2">
              <EyeOff size={18} aria-hidden="true" style={{ color: "#475569" }} />
              <h2 className="font-bold text-sm" style={{ color: "#334155" }}>
                Annonce retirée
              </h2>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: "#64748B" }}>
              Elle n'apparaît plus dans la recherche. Les candidatures en cours restent
              en l'état.
            </p>
            <RemiseEnLigne
              listing={existante}
              onRemiseEnLigne={(message) => {
                confirmer(message);
                onSauvegarde(existante);
              }}
            />
          </section>
        )}

        <MessageSucces message={succes ?? messageCreation} />

        {/* Hors du <form> : la vérification ne doit pas soumettre l'annonce. */}
        {bandeauTelephone && (
          <div ref={bandeauRef} tabIndex={-1} className="outline-none">
            <BandeauTelephoneAVerifier
              role={refusTelephone ? "alert" : "status"}
              message={refusTelephone ? creation.erreur : null}
              onVerifie={apresVerificationTelephone}
            />
          </div>
        )}

        {/* Bloc certification (édition seulement) */}
        {existante && (
          <BlocCertification
            listing={existante}
            onChangement={(message) => {
              if (message) confirmer(message);
              onSauvegarde(existante);
            }}
          />
        )}

        <form onSubmit={soumettre} className="space-y-5">
          {/* Description du bien */}
          <section
            className="rounded-2xl p-5 space-y-4"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold" style={{ color: "#1E293B" }}>
              Le bien
            </h2>

            {/* Premier choix du formulaire : il commande les champs affichés
                ensuite, mieux vaut le poser avant que l'annonce soit écrite. */}
            <div>
              <span className="block text-sm font-semibold mb-2" style={{ color: "#334155" }}>
                Que souhaitez-vous faire ? *
              </span>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    { valeur: "location" as const, titre: "Mettre en location", sous: "Loyer mensuel" },
                    { valeur: "vente" as const, titre: "Mettre en vente", sous: "Prix de cession" },
                  ]
                ).map((option) => {
                  const actif = form.type_transaction === option.valeur;
                  return (
                    <button
                      key={option.valeur}
                      type="button"
                      onClick={() =>
                        setForm((f) => ({ ...f, type_transaction: option.valeur }))
                      }
                      className="flex flex-col items-start gap-0.5 px-4 py-3 rounded-xl text-left transition-colors"
                      style={{
                        background: actif ? "#FFF7ED" : "#F8FAFC",
                        border: `1.5px solid ${actif ? "#F97316" : "#E2E8F0"}`,
                      }}
                    >
                      <span
                        className="font-semibold text-sm"
                        style={{ color: actif ? "#9A3412" : "#334155" }}
                      >
                        {option.titre}
                      </span>
                      <span className="text-xs" style={{ color: actif ? "#C2410C" : "#94A3B8" }}>
                        {option.sous}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="titre" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                Titre de l'annonce *
              </label>
              <input
                id="titre"
                required
                maxLength={200}
                value={form.title_fr}
                onChange={(e) => setForm((f) => ({ ...f, title_fr: e.target.value }))}
                placeholder="Appartement 3 chambres avec groupe électrogène — Kipé"
                className={CHAMP}
                style={STYLE_CHAMP}
              />
            </div>

            <div>
              <label htmlFor="desc" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                Description *
              </label>
              <textarea
                id="desc"
                required
                rows={5}
                value={form.description_fr}
                onChange={(e) => setForm((f) => ({ ...f, description_fr: e.target.value }))}
                placeholder="Décrivez le bien, son environnement, les accès… Plus la description est précise, moins vous recevrez de visites inutiles."
                className={`${CHAMP} resize-none`}
                style={STYLE_CHAMP}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="type" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                  Type *
                </label>
                <select
                  id="type"
                  value={form.type_bien}
                  onChange={(e) => setForm((f) => ({ ...f, type_bien: e.target.value }))}
                  className={CHAMP}
                  style={STYLE_CHAMP}
                >
                  {geo.typesBien.map((t) => (
                    <option key={t.valeur} value={t.valeur}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              {!bienSansPieces && (
                <div>
                  <label htmlFor="pieces" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                    Nombre de pièces
                  </label>
                  <input
                    id="pieces"
                    type="number"
                    min={1}
                    max={20}
                    value={form.nb_pieces}
                    onChange={(e) => setForm((f) => ({ ...f, nb_pieces: e.target.value }))}
                    className={CHAMP}
                    style={STYLE_CHAMP}
                  />
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="surface" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                  Superficie (m²)
                </label>
                <input
                  id="surface"
                  type="number"
                  min={0}
                  value={form.superficie}
                  onChange={(e) => setForm((f) => ({ ...f, superficie: e.target.value }))}
                  placeholder="85"
                  className={CHAMP}
                  style={STYLE_CHAMP}
                />
              </div>
              {!bienSansPieces && (
                <div>
                  <label htmlFor="etage" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                    Étage
                  </label>
                  <input
                    id="etage"
                    type="number"
                    min={0}
                    value={form.etage}
                    onChange={(e) => setForm((f) => ({ ...f, etage: e.target.value }))}
                    placeholder="0 = rez-de-chaussée"
                    className={CHAMP}
                    style={STYLE_CHAMP}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between py-1" hidden={bienSansPieces}>
              <p className="font-semibold text-sm" style={{ color: "#1E293B" }}>
                Bien meublé
              </p>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, meuble: !f.meuble }))}
                className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0"
                style={{ background: form.meuble ? "#F97316" : "#CBD5E1" }}
                aria-pressed={form.meuble}
                aria-label="Bien meublé"
              >
                <span
                  className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: form.meuble ? "translateX(26px)" : "translateX(4px)" }}
                />
              </button>
            </div>
          </section>

          {/* Localisation */}
          <section
            className="rounded-2xl p-5 space-y-4"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold" style={{ color: "#1E293B" }}>
              Localisation
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="ville" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                  Ville *
                </label>
                <select
                  id="ville"
                  value={form.ville}
                  onChange={(e) => setForm((f) => ({ ...f, ville: e.target.value, quartier: "" }))}
                  className={CHAMP}
                  style={STYLE_CHAMP}
                >
                  {geo.villes.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="quartier" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                  Quartier
                </label>
                <select
                  id="quartier"
                  value={form.quartier}
                  onChange={(e) => setForm((f) => ({ ...f, quartier: e.target.value }))}
                  className={CHAMP}
                  style={STYLE_CHAMP}
                >
                  <option value="">À préciser</option>
                  {geo.quartiers.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="adresse" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                Adresse ou repère
              </label>
              <input
                id="adresse"
                value={form.adresse}
                onChange={(e) => setForm((f) => ({ ...f, adresse: e.target.value }))}
                placeholder="Cité Kipé, immeuble Bhoye, 2ᵉ étage"
                className={CHAMP}
                style={STYLE_CHAMP}
              />
            </div>
          </section>

          {/* Loyer */}
          <section
            className="rounded-2xl p-5 space-y-4"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold" style={{ color: "#1E293B" }}>
              {estVente ? "Prix de vente" : "Loyer et charges"}
            </h2>

            <div>
              <label htmlFor="prix" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                {estVente ? "Prix de vente (GNF) *" : "Loyer mensuel (GNF) *"}
              </label>
              <input
                id="prix"
                type="number"
                required
                min={1}
                inputMode="numeric"
                value={form.prix}
                onChange={(e) => setForm((f) => ({ ...f, prix: e.target.value }))}
                placeholder={estVente ? "850000000" : "2800000"}
                className={CHAMP}
                style={STYLE_CHAMP}
              />
            </div>

            <div className="grid grid-cols-2 gap-3" hidden={estVente}>
              <div>
                <label htmlFor="charges" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                  Charges (GNF)
                </label>
                <input
                  id="charges"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.charges}
                  onChange={(e) => setForm((f) => ({ ...f, charges: e.target.value }))}
                  placeholder="200000"
                  className={CHAMP}
                  style={STYLE_CHAMP}
                />
              </div>
              <div>
                <label htmlFor="caution" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                  Caution (GNF)
                </label>
                <input
                  id="caution"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={form.caution}
                  onChange={(e) => setForm((f) => ({ ...f, caution: e.target.value }))}
                  placeholder="5600000"
                  className={CHAMP}
                  style={STYLE_CHAMP}
                />
              </div>
            </div>

            {!estVente && coutEntree > 0 && (
              <div className="px-3.5 py-3 rounded-xl" style={{ background: "#FFF7ED" }}>
                <p className="text-xs" style={{ color: "#9A3412" }}>
                  Coût d'entrée affiché au locataire :{" "}
                  <strong>{formatMontant(coutEntree, "GNF")}</strong>
                </p>
              </div>
            )}

            {estVente && (
              <div className="px-3.5 py-3 rounded-xl" style={{ background: "#EFF6FF" }}>
                <p className="text-xs leading-relaxed" style={{ color: "#1D4ED8" }}>
                  La cession se conclut devant notaire, hors plateforme. Tcheyna vous
                  met en relation avec des acquéreurs et conserve la trace des échanges ;
                  ni caution ni loyer ne sont demandés, et <strong>aucun frais de mise en
                  relation n'est dû sur une vente</strong>.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="dispo" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                {estVente ? "Disponible à la vente à partir du" : "Disponible à partir du"}
              </label>
              <input
                id="dispo"
                type="date"
                value={form.disponible_a_partir}
                onChange={(e) => setForm((f) => ({ ...f, disponible_a_partir: e.target.value }))}
                className={CHAMP}
                style={STYLE_CHAMP}
              />
            </div>
          </section>

          {/* Équipements */}
          <section
            className="rounded-2xl p-5"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold mb-3" style={{ color: "#1E293B" }}>
              Équipements
            </h2>
            <div className="flex flex-wrap gap-2">
              {EQUIPEMENTS.map((eq) => {
                const actif = form[eq.cle];
                return (
                  <button
                    key={eq.cle}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, [eq.cle]: !f[eq.cle] }))}
                    className="px-3.5 py-2 rounded-full text-xs font-semibold transition-colors flex items-center gap-1.5"
                    style={{ background: actif ? "#F97316" : "#F0F4FA", color: actif ? "white" : "#64748B" }}
                  >
                    {actif && <Check size={13} />}
                    {eq.label}
                  </button>
                );
              })}
            </div>
          </section>

          {/* Photos */}
          <section
            className="rounded-2xl p-5 space-y-3"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold" style={{ color: "#1E293B" }}>
              Photos du bien
            </h2>
            <TeleversementPhotos
              listingId={courante?.id}
              images={images}
              onImagesChange={setImages}
              photos={photos}
              onRepriseTerminee={apresReprise}
            />
          </section>

          <MessageErreur message={erreur} />

          <button
            ref={publierRef}
            type="submit"
            disabled={enCours}
            className="w-full py-4 rounded-2xl font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
            style={{ background: "#F97316", fontSize: "16px" }}
          >
            {enCours ? "Enregistrement…" : courante ? "Enregistrer les modifications" : "Publier l'annonce"}
          </button>

          {/* Création terminée mais photos en échec : on laisse le choix. */}
          {creee && !photos.resume.occupee && (
            <button
              type="button"
              onClick={() => onSauvegarde(creee)}
              className="w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"
              style={{ background: "#F0F4FA", color: "#1E3A5F" }}
            >
              {photos.resume.enEchec > 0 ? "Continuer sans ces photos" : "Voir mon annonce"}
              <ArrowRight size={17} />
            </button>
          )}

          {existante && !existante.retiree && confirmationRetrait && (
            <ConfirmationRetrait
              enCours={retrait.enCours}
              onConfirmer={retirer}
              onAnnuler={() => setConfirmationRetrait(false)}
            />
          )}

          {existante && !existante.retiree && !confirmationRetrait && (
            <button
              type="button"
              onClick={() => setConfirmationRetrait(true)}
              disabled={retrait.enCours}
              className="w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "#FEE2E2", color: "#DC2626" }}
            >
              <EyeOff size={17} />
              Retirer l'annonce
            </button>
          )}
        </form>

      </div>
    </div>
  );
}

/* ─── Bloc certification ───────────────────────────────────── */

/** Ce que la certification apporte, rappelé dans la modale de paiement. */
const DESCRIPTION_CERTIFICATION =
  "Un vérificateur Tcheyna contrôle vos pièces de propriété. Une fois accordé, le badge « Annonce Certifiée » s'affiche sur votre bien et le fait remonter dans les résultats.";

function BlocCertification({
  listing,
  onChangement,
}: {
  listing: Listing;
  /** Message à confirmer (ou `null`), puis rechargement de l'annonce. */
  onChangement: (message: string | null) => void;
}) {
  const [nbDocuments, setNbDocuments] = useState(listing.nb_documents);
  const [paiementOuvert, setPaiementOuvert] = useState(false);
  // Motif du 402 renvoyé par le serveur, repris dans la modale de paiement.
  const [motifPaiement, setMotifPaiement] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState({ enCours: false, erreur: null as string | null });

  /**
   * Demande de certification. Le serveur décide seul si elle est due (D4) :
   * un 402 ouvre le paiement, sauf juste après un paiement, où il n'est
   * qu'affiché (pas de boucle de paiements).
   */
  async function demander(apresPaiement: boolean) {
    if (envoi.enCours) return;
    setEnvoi({ enCours: true, erreur: null });
    try {
      await listingsAPI.demanderCertification(listing.id);
      setEnvoi({ enCours: false, erreur: null });
      onChangement("Demande de certification envoyée");
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Une erreur est survenue";
      if (!apresPaiement && err instanceof ApiError && err.statut === 402) {
        setEnvoi({ enCours: false, erreur: null });
        setMotifPaiement(message);
        setPaiementOuvert(true);
        return;
      }
      setEnvoi({ enCours: false, erreur: message });
      // Après un paiement, l'annonce a pu changer (examen ouvert à la
      // confirmation) : on la relit même si la demande échoue.
      if (apresPaiement) onChangement(null);
    }
  }

  const CONFIGS = {
    certified: {
      fond: "#ECFDF5",
      bordure: "#A7F3D0",
      titre: "#065F46",
      texte: "#047857",
      libelle: "Annonce certifiée",
      message:
        "Votre annonce affiche le badge « Certifiée » et remonte dans les résultats de recherche.",
    },
    pending: {
      fond: "#FEF3C7",
      bordure: "#FDE68A",
      titre: "#92400E",
      texte: "#B45309",
      libelle: "Certification en cours d'examen",
      message: "Un vérificateur Tcheyna examine vos pièces. Réponse sous 48 h.",
    },
    rejected: {
      fond: "#FEE2E2",
      bordure: "#FECACA",
      titre: "#991B1B",
      texte: "#B91C1C",
      libelle: "Certification refusée",
      message:
        "Complétez ou remplacez les pièces demandées, puis relancez la certification. "
        + "Le motif du refus figure dans vos notifications.",
    },
    none: {
      fond: "#EFF6FF",
      bordure: "#BFDBFE",
      titre: "#1E3070",
      texte: "#1D4ED8",
      libelle: "Faire certifier cette annonce",
      message:
        "Une annonce certifiée est mise en avant dans les résultats et accessible aux "
        + "locataires vérifiés niveau 2 et plus.",
    },
  };

  const config = CONFIGS[listing.certification_status];
  const enExamen = listing.certification_status === "pending";
  const peutDemander =
    listing.certification_status === "none" || listing.certification_status === "rejected";
  // Le serveur dit qu'aucun nouveau paiement n'est dû (re-soumission gratuite
  // notamment) : la demande part directement. Champ absent (serveur antérieur
  // au lot 2.2) : parcours d'avant, paiement d'abord.
  const sansPaiement = listing.certification_resoumission?.paiement_requis === false;
  const relance = listing.certification_status === "rejected";

  return (
    <div
      className="rounded-2xl p-5 space-y-3"
      style={{ background: config.fond, border: `1.5px solid ${config.bordure}` }}
    >
      <div className="flex items-center gap-2">
        <ShieldCheck size={19} style={{ color: config.titre }} />
        <h2 className="font-bold text-sm" style={{ color: config.titre }}>
          {config.libelle}
        </h2>
      </div>

      <p className="text-xs leading-relaxed" style={{ color: config.texte }}>
        {config.message}
      </p>

      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: config.titre }}>
          Documents administratifs
        </p>
        <TeleversementDocuments
          listingId={listing.id}
          verrouille={enExamen}
          onChangement={setNbDocuments}
        />
      </div>

      {peutDemander && (
        <>
          <EtatResoumission listing={listing} />

          {!sansPaiement && (
            <div
              className="flex items-baseline justify-between px-3.5 py-2.5 rounded-xl"
              style={{ background: "rgba(255,255,255,0.65)" }}
            >
              <span className="text-xs font-semibold" style={{ color: config.titre }}>
                Frais de certification
              </span>
              <span className="text-sm font-bold" style={{ color: "#EA580C" }}>
                {formatMontant(PRIX_CERTIFICATION, listing.devise)}
              </span>
            </div>
          )}

          <MessageErreur message={envoi.erreur} />

          <button
            type="button"
            onClick={() => {
              if (sansPaiement) void demander(false);
              else {
                setMotifPaiement(null);
                setPaiementOuvert(true);
              }
            }}
            disabled={!nbDocuments || !listing.images.length || envoi.enCours}
            className="w-full py-3.5 rounded-2xl font-semibold text-white disabled:opacity-50"
            style={{ background: "#1E3A5F" }}
          >
            {envoi.enCours
              ? "Envoi…"
              : !sansPaiement
                ? "Régler et demander la certification"
                : relance
                  ? "Relancer la certification"
                  : "Demander la certification"}
          </button>

          {(!nbDocuments || !listing.images.length) && (
            <p className="text-xs text-center" style={{ color: config.texte }}>
              {!listing.images.length && !nbDocuments
                ? "Ajoutez au moins une photo et une pièce administrative."
                : !listing.images.length
                  ? "Ajoutez au moins une photo du bien."
                  : "Ajoutez au moins une pièce administrative."}
            </p>
          )}
        </>
      )}

      {paiementOuvert && (
        <ModalePaiement
          type="certification"
          titre="Certification de l'annonce"
          description={motifPaiement ?? DESCRIPTION_CERTIFICATION}
          montant={PRIX_CERTIFICATION}
          devise={listing.devise}
          listingId={listing.id}
          onFerme={() => setPaiementOuvert(false)}
          onPaye={() => {
            // Passerelle hors ligne : le dossier part quand même à l'examen.
            // Avec la passerelle, l'utilisateur est parti chez l'opérateur.
            setPaiementOuvert(false);
            void demander(true);
          }}
        />
      )}
    </div>
  );
}
