/**
 * OwnerListingForm.tsx — Création et gestion d'une annonce.
 *
 * En édition, la page porte aussi le parcours de certification : dépôt du
 * document de propriété, demande, et suivi de la décision.
 */
import { ArrowLeft, Check, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { listingsAPI, type DonneesAnnonce, type Listing } from "../../api";
import { Chargement, Erreur, MessageErreur, MessageSucces } from "../../components/Etats";
import { TeleversementDocuments } from "../../components/TeleversementDocuments";
import {
  envoyerPhotosEnAttente,
  TeleversementPhotos,
  type PhotoEnAttente,
} from "../../components/TeleversementPhotos";
import { useAction, useApi } from "../../hooks/useApi";
import { useGeo } from "../../hooks/useGeo";
import { formatMontant } from "../../lib/format";

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
      onSuppression={() => navigate("/owner/listings", { replace: true })}
    />
  );
}

function Formulaire({
  existante,
  onSauvegarde,
  onSuppression,
}: {
  existante: Listing | null;
  onSauvegarde: (listing: Listing) => void;
  onSuppression: () => void;
}) {
  const geo = useGeo("Guinée", "Conakry");
  const [succes, setSucces] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>(existante?.images ?? []);
  // En création, l'annonce n'a pas encore d'identifiant : les photos sont
  // retenues ici puis envoyées juste après l'enregistrement.
  const [photosEnAttente, setPhotosEnAttente] = useState<PhotoEnAttente[]>([]);

  const [form, setForm] = useState<Formulaire>(
    existante
      ? {
          title_fr: existante.title,
          description_fr: existante.description,
          ville: existante.ville,
          quartier: existante.quartier ?? "",
          adresse: existante.adresse ?? "",
          type_bien: existante.type_bien,
          prix: String(existante.prix),
          charges: String(existante.charges ?? ""),
          caution: existante.caution != null ? String(existante.caution) : "",
          nb_pieces: String(existante.nb_pieces),
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

  const [erreurPhotos, setErreurPhotos] = useState<string | null>(null);
  const creation = useAction(listingsAPI.creer);
  const modification = useAction(listingsAPI.modifier);
  const retrait = useAction(listingsAPI.retirer);
  const demandeCertification = useAction(listingsAPI.demanderCertification);

  const enCours = creation.enCours || modification.enCours;
  const erreur = creation.erreur ?? modification.erreur ?? retrait.erreur;

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
      type_bien: form.type_bien,
      prix: Number(form.prix),
      charges: form.charges ? Number(form.charges) : 0,
      caution: form.caution ? Number(form.caution) : undefined,
      devise: "GNF",
      nb_pieces: Number(form.nb_pieces) || 1,
      superficie: form.superficie ? Number(form.superficie) : undefined,
      etage: form.etage ? Number(form.etage) : undefined,
      meuble: form.meuble,
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
    const reponse = existante
      ? await modification.executer(existante.id, donnees())
      : await creation.executer(donnees());
    if (!reponse) return;

    // Les photos choisies avant la création partent maintenant que
    // l'annonce possède un identifiant.
    if (photosEnAttente.length) {
      try {
        const envoyees = await envoyerPhotosEnAttente(reponse.listing.id, photosEnAttente);
        setImages(envoyees);
        setPhotosEnAttente([]);
      } catch (err) {
        // L'annonce est enregistrée : on le dit, et on signale ce qui manque.
        confirmer("Annonce publiée, mais les photos n'ont pas pu être envoyées");
        onSauvegarde(reponse.listing);
        setErreurPhotos(err instanceof Error ? err.message : "Envoi des photos impossible");
        return;
      }
    }

    confirmer(existante ? "Annonce mise à jour" : "Annonce publiée");
    onSauvegarde(reponse.listing);
  }

  async function supprimer() {
    if (!existante) return;
    if (!window.confirm("Retirer cette annonce ? Elle ne sera plus visible des locataires.")) return;
    const ok = await retrait.executer(existante.id);
    if (ok) onSuppression();
  }

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
            {existante ? "Modifier l'annonce" : "Publier une annonce"}
          </h1>
        </div>
      </div>

      <div className="px-4 pt-5 space-y-5">
        <MessageSucces message={succes} />

        {/* Bloc certification (édition seulement) */}
        {existante && (
          <BlocCertification
            listing={existante}
            demande={demandeCertification}
            onChangement={async (message) => {
              confirmer(message);
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
            </div>

            <div className="flex items-center justify-between py-1">
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
              Loyer et charges
            </h2>

            <div>
              <label htmlFor="prix" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                Loyer mensuel (GNF) *
              </label>
              <input
                id="prix"
                type="number"
                required
                min={1}
                inputMode="numeric"
                value={form.prix}
                onChange={(e) => setForm((f) => ({ ...f, prix: e.target.value }))}
                placeholder="2800000"
                className={CHAMP}
                style={STYLE_CHAMP}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
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

            {coutEntree > 0 && (
              <div className="px-3.5 py-3 rounded-xl" style={{ background: "#FFF7ED" }}>
                <p className="text-xs" style={{ color: "#9A3412" }}>
                  Coût d'entrée affiché au locataire :{" "}
                  <strong>{formatMontant(coutEntree, "GNF")}</strong>
                </p>
              </div>
            )}

            <div>
              <label htmlFor="dispo" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                Disponible à partir du
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
              listingId={existante?.id}
              images={images}
              onImagesChange={setImages}
              enAttente={photosEnAttente}
              onEnAttenteChange={setPhotosEnAttente}
            />
            <MessageErreur message={erreurPhotos} />
          </section>

          <MessageErreur message={erreur} />

          <button
            type="submit"
            disabled={enCours}
            className="w-full py-4 rounded-2xl font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
            style={{ background: "#F97316", fontSize: "16px" }}
          >
            {enCours ? "Enregistrement…" : existante ? "Enregistrer les modifications" : "Publier l'annonce"}
          </button>

          {existante && (
            <button
              type="button"
              onClick={supprimer}
              disabled={retrait.enCours}
              className="w-full py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "#FEE2E2", color: "#DC2626" }}
            >
              <Trash2 size={17} />
              Retirer l'annonce
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

/* ─── Bloc certification ───────────────────────────────────── */

function BlocCertification({
  listing,
  demande,
  onChangement,
}: {
  listing: Listing;
  demande: ReturnType<typeof useAction<[string], { message: string; listing: Listing }>>;
  onChangement: (message: string) => Promise<void> | void;
}) {
  const [nbDocuments, setNbDocuments] = useState(listing.nb_documents);

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
          <MessageErreur message={demande.erreur} />

          <button
            onClick={async () => {
              const ok = await demande.executer(listing.id);
              if (ok) await onChangement("Demande de certification envoyée");
            }}
            disabled={!nbDocuments || !listing.images.length || demande.enCours}
            className="w-full py-3.5 rounded-2xl font-semibold text-white disabled:opacity-50"
            style={{ background: "#1E3A5F" }}
          >
            {demande.enCours ? "Envoi…" : "Demander la certification"}
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
    </div>
  );
}
