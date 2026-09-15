import {
  BadgeCheck,
  CheckCircle,
  LogOut,
  Mail,
  MapPin,
  Phone,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { LucideIcon } from "lucide-react";

import { paiementsAPI, passportAPI, type TenantPassport, type TypeDocument } from "../../api";
import { BadgeVerification, ScoreCircle, VerificationSteps } from "../../components/BadgeVerification";
import { ChangementMotDePasse } from "../../components/ChangementMotDePasse";
import { LiensLegaux } from "../../components/LiensLegaux";
import { TeleversementAvatar } from "../../components/TeleversementAvatar";
import { Chargement, Erreur, MessageErreur, MessageSucces } from "../../components/Etats";
import { ModalePaiement } from "../../components/ModalePaiement";
import { PhoneVerification } from "../../components/PhoneVerification";
import { useAuth } from "../../context/AuthContext";
import { useAction, useApi } from "../../hooks/useApi";
import { useGeo } from "../../hooks/useGeo";
import { formatMontant } from "../../lib/format";

/** Tarif de l'abonnement Passeport, aligné sur la grille du serveur. */
const PRIX_ABONNEMENT = 150_000;

const DOCUMENTS: { type: TypeDocument; label: string; aide: string }[] = [
  { type: "cni_recto", label: "CNI — recto", aide: "Face avant de votre carte d'identité" },
  { type: "cni_verso", label: "CNI — verso", aide: "Face arrière" },
  { type: "passport", label: "Passeport", aide: "Alternative à la CNI" },
  { type: "income", label: "Justificatif de revenus", aide: "Bulletin de paie ou attestation" },
];

const SITUATIONS = ["salarié", "indépendant", "commerçant", "fonctionnaire", "étudiant", "autre"];

type Onglet = "dossier" | "criteres" | "compte";

const CHAMP = "w-full px-4 py-3 rounded-xl outline-none";
const STYLE_CHAMP = { background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" };

export function TenantProfile() {
  const navigate = useNavigate();
  const { user, deconnecter, rafraichir } = useAuth();
  const [onglet, setOnglet] = useState<Onglet>("dossier");
  const [succes, setSucces] = useState<string | null>(null);

  const passeport = useApi(() => passportAPI.recuperer(), []);

  function confirmer(message: string) {
    setSucces(message);
    setTimeout(() => setSucces(null), 3000);
  }

  async function rafraichirTout(message: string) {
    confirmer(message);
    await rafraichir();
    await passeport.recharger();
  }

  if (passeport.chargement) return <Chargement texte="Chargement de votre passeport…" />;
  if (passeport.erreur || !passeport.data) {
    return (
      <Erreur
        message={passeport.erreur ?? "Passeport indisponible"}
        onReessayer={passeport.recharger}
      />
    );
  }

  const p = passeport.data;
  const niveau = user?.trust_level ?? 0;

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-8" style={{ background: "#1E3A5F" }}>
        <h1 className="text-white font-bold mb-5" style={{ fontSize: "20px" }}>
          Mon Passeport Locataire
        </h1>

        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <TeleversementAvatar taille={64} surFonce />
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-lg truncate">{user?.full_name}</h2>
            <p className="text-white/60 text-sm truncate">
              {p.situation_pro
                ? p.situation_pro.charAt(0).toUpperCase() + p.situation_pro.slice(1)
                : "Situation à préciser"}
            </p>
            <div className="mt-2">
              <BadgeVerification level={niveau} size="sm" />
            </div>
          </div>
          <ScoreCircle score={p.score} size={64} />
        </div>
      </div>

      <div className="px-4 -mt-4 relative z-10">
        <div
          className="flex gap-1 p-1 rounded-2xl"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.1)" }}
        >
          {(
            [
              { cle: "dossier" as const, label: "Dossier" },
              { cle: "criteres" as const, label: "Ma recherche" },
              { cle: "compte" as const, label: "Compte" },
            ]
          ).map((o) => (
            <button
              key={o.cle}
              onClick={() => setOnglet(o.cle)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
              style={{
                background: onglet === o.cle ? "#F97316" : "transparent",
                color: onglet === o.cle ? "white" : "#64748B",
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 mt-5 space-y-5">
        <MessageSucces message={succes} />

        {onglet === "dossier" && (
          <OngletDossier passeport={p} niveau={niveau} onChangement={rafraichirTout} />
        )}

        {onglet === "criteres" && (
          <OngletCriteres
            passeport={p}
            onEnregistre={() => rafraichirTout("Critères de recherche enregistrés")}
          />
        )}

        {onglet === "compte" && (
          <div
            className="rounded-2xl p-5 space-y-3"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h3 className="font-bold mb-2" style={{ color: "#1E293B" }}>
              Informations du compte
            </h3>
            <InfoLigne icone={Users} label="Nom complet" valeur={user?.full_name ?? "—"} />
            <InfoLigne icone={Mail} label="Adresse e-mail" valeur={user?.email ?? "—"} />
            <InfoLigne
              icone={Phone}
              label="Téléphone"
              valeur={
                user?.phone
                  ? `${user.phone}${user.phone_verified ? " · vérifié" : " · non vérifié"}`
                  : "Non renseigné"
              }
            />
            <InfoLigne
              icone={MapPin}
              label="Localisation"
              valeur={[user?.quartier, user?.ville, user?.pays].filter(Boolean).join(", ") || "—"}
            />

            <div className="pt-4 mt-2 border-t border-gray-100">
              <ChangementMotDePasse />
            </div>

            <button
              onClick={() => {
                deconnecter();
                navigate("/");
              }}
              className="w-full mt-2 py-3.5 rounded-2xl font-semibold flex items-center justify-center gap-2"
              style={{ background: "#FEE2E2", color: "#DC2626" }}
            >
              <LogOut size={17} />
              Se déconnecter
            </button>

            <LiensLegaux />
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Abonnement Passeport ─────────────────────────────────── */

/**
 * L'abonnement ne remplace pas la vérification : il met en avant un dossier
 * déjà vérifié auprès des propriétaires. Le dire clairement évite de vendre
 * un niveau de confiance qui, lui, ne s'achète pas.
 */
function AbonnementPasseport() {
  const [ouvert, setOuvert] = useState(false);
  const paiements = useApi(() => paiementsAPI.mesPaiements(), []);

  const actif = (paiements.data?.paiements ?? []).some(
    (p) => p.type_paiement === "abonnement_passeport" && p.statut === "success",
  );

  return (
    <div
      className="rounded-2xl p-5"
      style={
        actif
          ? { background: "#ECFDF5", border: "1.5px solid #A7F3D0" }
          : { background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }
      }
    >
      <div className="flex items-center gap-2 mb-2">
        <BadgeCheck size={19} style={{ color: actif ? "#047857" : "#F97316" }} />
        <h3 className="font-bold" style={{ color: actif ? "#065F46" : "#1E293B" }}>
          {actif ? "Abonnement Passeport actif" : "Abonnement Passeport Locataire"}
        </h3>
      </div>

      <p className="text-xs leading-relaxed mb-4" style={{ color: actif ? "#047857" : "#64748B" }}>
        {actif
          ? "Votre dossier est mis en avant auprès des propriétaires pendant un an. Votre niveau de confiance, lui, reste acquis par la vérification de vos pièces."
          : "Votre dossier vérifié est proposé en priorité aux propriétaires dont les biens correspondent à votre recherche, pendant un an. L'abonnement ne fait pas monter votre niveau de confiance : seules vos pièces vérifiées le font."}
      </p>

      {!actif && (
        <button
          onClick={() => setOuvert(true)}
          className="w-full py-3 rounded-xl text-sm font-semibold text-white"
          style={{ background: "#F97316" }}
        >
          S'abonner · {formatMontant(PRIX_ABONNEMENT, "GNF")} / an
        </button>
      )}

      {ouvert && (
        <ModalePaiement
          type="abonnement_passeport"
          titre="Abonnement Passeport Locataire"
          description="Un an de mise en avant de votre dossier auprès des propriétaires. Sans engagement de reconduction."
          montant={PRIX_ABONNEMENT}
          onFerme={() => setOuvert(false)}
          onPaye={() => void paiements.recharger()}
        />
      )}
    </div>
  );
}

/* ─── Onglet « Dossier » ───────────────────────────────────── */

function OngletDossier({
  passeport,
  niveau,
  onChangement,
}: {
  passeport: TenantPassport;
  niveau: number;
  onChangement: (message: string) => Promise<void>;
}) {
  const { user } = useAuth();
  const [situation, setSituation] = useState({
    situation_pro: passeport.situation_pro ?? "salarié",
    employeur: passeport.employeur ?? "",
    revenu_mensuel: passeport.revenu_mensuel?.toString() ?? "",
    a_un_garant: passeport.a_un_garant,
    garant_nom: passeport.garant_nom ?? "",
    garant_revenu: passeport.garant_revenu?.toString() ?? "",
  });

  const enregistrement = useAction(passportAPI.mettreAJour);
  const televersement = useAction(passportAPI.televerser);
  const suppression = useAction(passportAPI.supprimerDocument);

  async function enregistrer() {
    const ok = await enregistrement.executer({
      situation_pro: situation.situation_pro,
      employeur: situation.employeur || undefined,
      revenu_mensuel: situation.revenu_mensuel ? Number(situation.revenu_mensuel) : undefined,
      devise: "GNF",
      a_un_garant: situation.a_un_garant,
      garant_nom: situation.a_un_garant ? situation.garant_nom || undefined : undefined,
      garant_revenu:
        situation.a_un_garant && situation.garant_revenu
          ? Number(situation.garant_revenu)
          : undefined,
    });
    if (ok) await onChangement("Situation professionnelle enregistrée");
  }

  return (
    <>
      {/* Vérification du téléphone tant qu'elle manque */}
      {!user?.phone_verified && (
        <div
          className="rounded-2xl p-5"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          <PhoneVerification onVerifie={() => void onChangement("Téléphone vérifié")} />
        </div>
      )}

      {/* Parcours de vérification */}
      <div
        className="rounded-2xl p-5"
        style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
      >
        <h3 className="font-bold mb-4" style={{ color: "#1E293B" }}>
          Parcours de vérification
        </h3>
        <VerificationSteps etapes={passeport.etapes} niveauActuel={niveau} />
        {passeport.prochain_niveau && (
          <div className="mt-4 p-3 rounded-xl" style={{ background: "#F0F4FA" }}>
            <p className="text-xs font-semibold mb-0.5" style={{ color: "#1E3A5F" }}>
              Niveau suivant : {passeport.prochain_niveau.label}
            </p>
            <p className="text-xs text-gray-500">{passeport.prochain_niveau.debloque}</p>
          </div>
        )}
      </div>

      <AbonnementPasseport />

      {/* Situation professionnelle */}
      <div
        className="rounded-2xl p-5 space-y-4"
        style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
      >
        <h3 className="font-bold" style={{ color: "#1E293B" }}>
          Situation professionnelle
        </h3>

        <div>
          <label htmlFor="sit" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
            Statut
          </label>
          <select
            id="sit"
            value={situation.situation_pro}
            onChange={(e) => setSituation((s) => ({ ...s, situation_pro: e.target.value }))}
            className={CHAMP}
            style={STYLE_CHAMP}
          >
            {SITUATIONS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="emp" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
            Employeur / activité
          </label>
          <input
            id="emp"
            value={situation.employeur}
            onChange={(e) => setSituation((s) => ({ ...s, employeur: e.target.value }))}
            placeholder="Orange Guinée, commerce…"
            className={CHAMP}
            style={STYLE_CHAMP}
          />
        </div>

        <div>
          <label htmlFor="rev" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
            Revenu mensuel net (GNF)
          </label>
          <input
            id="rev"
            type="number"
            inputMode="numeric"
            value={situation.revenu_mensuel}
            onChange={(e) => setSituation((s) => ({ ...s, revenu_mensuel: e.target.value }))}
            placeholder="3000000"
            className={CHAMP}
            style={STYLE_CHAMP}
          />
          <p className="text-xs text-gray-400 mt-1.5">
            Modifier ce montant remet la validation à zéro : un vérificateur devra le confirmer.
          </p>
        </div>

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="font-semibold text-sm" style={{ color: "#1E293B" }}>
              J'ai un garant
            </p>
            <p className="text-xs text-gray-400">Renforce votre dossier</p>
          </div>
          <button
            type="button"
            onClick={() => setSituation((s) => ({ ...s, a_un_garant: !s.a_un_garant }))}
            className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0"
            style={{ background: situation.a_un_garant ? "#F97316" : "#CBD5E1" }}
            aria-pressed={situation.a_un_garant}
            aria-label="J'ai un garant"
          >
            <span
              className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform"
              style={{ transform: situation.a_un_garant ? "translateX(26px)" : "translateX(4px)" }}
            />
          </button>
        </div>

        {situation.a_un_garant && (
          <div className="grid grid-cols-2 gap-3">
            <input
              value={situation.garant_nom}
              onChange={(e) => setSituation((s) => ({ ...s, garant_nom: e.target.value }))}
              placeholder="Nom du garant"
              aria-label="Nom du garant"
              className={CHAMP}
              style={STYLE_CHAMP}
            />
            <input
              type="number"
              inputMode="numeric"
              value={situation.garant_revenu}
              onChange={(e) => setSituation((s) => ({ ...s, garant_revenu: e.target.value }))}
              placeholder="Revenu (GNF)"
              aria-label="Revenu du garant"
              className={CHAMP}
              style={STYLE_CHAMP}
            />
          </div>
        )}

        <MessageErreur message={enregistrement.erreur} />

        <button
          onClick={enregistrer}
          disabled={enregistrement.enCours}
          className="w-full py-3.5 rounded-2xl font-semibold text-white disabled:opacity-60"
          style={{ background: "#1E3A5F" }}
        >
          {enregistrement.enCours ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {/* Documents */}
      <div
        className="rounded-2xl p-5 space-y-3"
        style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold" style={{ color: "#1E293B" }}>
            Documents
          </h3>
          <span className="text-xs text-gray-400">JPG, PNG ou PDF — 10 Mo max</span>
        </div>

        {DOCUMENTS.map((doc) => {
          const present = passeport.documents?.[doc.type] ?? false;
          return (
            <div
              key={doc.type}
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{
                background: present ? "#ECFDF5" : "#F8FAFC",
                border: `1.5px solid ${present ? "#A7F3D0" : "#E2E8F0"}`,
              }}
            >
              {present ? (
                <CheckCircle size={19} style={{ color: "#10B981", flexShrink: 0 }} />
              ) : (
                <Upload size={19} style={{ color: "#94A3B8", flexShrink: 0 }} />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm" style={{ color: "#1E293B" }}>
                  {doc.label}
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {present ? "Envoyé — vérification sous 48 h" : doc.aide}
                </p>
              </div>

              {present ? (
                <button
                  onClick={async () => {
                    const ok = await suppression.executer(doc.type);
                    if (ok) await onChangement("Document supprimé");
                  }}
                  disabled={suppression.enCours}
                  className="p-2 rounded-lg flex-shrink-0"
                  style={{ background: "#FEE2E2", color: "#DC2626" }}
                  aria-label={`Supprimer ${doc.label}`}
                >
                  <Trash2 size={15} />
                </button>
              ) : (
                <label
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer flex-shrink-0"
                  style={{ background: "#FFF7ED", color: "#F97316" }}
                >
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    className="sr-only"
                    onChange={async (e) => {
                      const fichier = e.target.files?.[0];
                      e.target.value = "";
                      if (!fichier) return;
                      const ok = await televersement.executer(doc.type, fichier);
                      if (ok) await onChangement("Document envoyé — vérification sous 48 h");
                    }}
                  />
                  Ajouter
                </label>
              )}
            </div>
          );
        })}

        <MessageErreur message={televersement.erreur ?? suppression.erreur} />
      </div>
    </>
  );
}

/* ─── Onglet « Ma recherche » ──────────────────────────────── */

function OngletCriteres({
  passeport,
  onEnregistre,
}: {
  passeport: TenantPassport;
  onEnregistre: () => Promise<void>;
}) {
  const geo = useGeo("Guinée", passeport.ville_souhaitee ?? "Conakry");

  const [criteres, setCriteres] = useState({
    budget_min: passeport.budget_min?.toString() ?? "",
    budget_max: passeport.budget_max?.toString() ?? "",
    ville_souhaitee: passeport.ville_souhaitee ?? "Conakry",
    quartiers_souhaites: passeport.quartiers_souhaites ?? [],
    type_bien_souhaite: passeport.type_bien_souhaite ?? "appartement",
    nb_pieces_min: passeport.nb_pieces_min?.toString() ?? "",
    nb_occupants: passeport.nb_occupants?.toString() ?? "1",
    date_emmenagement: passeport.date_emmenagement ?? "",
  });

  const enregistrement = useAction(passportAPI.enregistrerCriteres);

  function basculerQuartier(quartier: string) {
    setCriteres((c) => ({
      ...c,
      quartiers_souhaites: c.quartiers_souhaites.includes(quartier)
        ? c.quartiers_souhaites.filter((q) => q !== quartier)
        : [...c.quartiers_souhaites, quartier],
    }));
  }

  async function enregistrer() {
    const ok = await enregistrement.executer({
      budget_min: criteres.budget_min ? Number(criteres.budget_min) : undefined,
      budget_max: criteres.budget_max ? Number(criteres.budget_max) : undefined,
      ville_souhaitee: criteres.ville_souhaitee,
      quartiers_souhaites: criteres.quartiers_souhaites,
      type_bien_souhaite: criteres.type_bien_souhaite,
      nb_pieces_min: criteres.nb_pieces_min ? Number(criteres.nb_pieces_min) : undefined,
      nb_occupants: criteres.nb_occupants ? Number(criteres.nb_occupants) : undefined,
      date_emmenagement: criteres.date_emmenagement || undefined,
    });
    if (ok) await onEnregistre();
  }

  return (
    <>
      <div className="rounded-2xl p-4" style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE" }}>
        <p className="text-sm font-semibold mb-1" style={{ color: "#1E3070" }}>
          Ces critères pilotent votre matching
        </p>
        <p className="text-xs" style={{ color: "#1D4ED8" }}>
          Plus ils sont précis, plus les annonces qui vous sont proposées correspondent à ce que vous
          cherchez réellement.
        </p>
      </div>

      <div
        className="rounded-2xl p-5 space-y-4"
        style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="c-bmin" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
              Budget min. (GNF)
            </label>
            <input
              id="c-bmin"
              type="number"
              inputMode="numeric"
              value={criteres.budget_min}
              onChange={(e) => setCriteres((c) => ({ ...c, budget_min: e.target.value }))}
              placeholder="1000000"
              className={CHAMP}
              style={STYLE_CHAMP}
            />
          </div>
          <div>
            <label htmlFor="c-bmax" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
              Budget max. (GNF)
            </label>
            <input
              id="c-bmax"
              type="number"
              inputMode="numeric"
              value={criteres.budget_max}
              onChange={(e) => setCriteres((c) => ({ ...c, budget_max: e.target.value }))}
              placeholder="3000000"
              className={CHAMP}
              style={STYLE_CHAMP}
            />
          </div>
        </div>

        {criteres.budget_max && (
          <p className="text-xs text-gray-400 -mt-2">
            Soit {formatMontant(Number(criteres.budget_max))} par mois, charges comprises.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="c-type" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
              Type de bien
            </label>
            <select
              id="c-type"
              value={criteres.type_bien_souhaite}
              onChange={(e) => setCriteres((c) => ({ ...c, type_bien_souhaite: e.target.value }))}
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
            <label htmlFor="c-ville" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
              Ville
            </label>
            <select
              id="c-ville"
              value={criteres.ville_souhaitee}
              onChange={(e) =>
                setCriteres((c) => ({ ...c, ville_souhaitee: e.target.value, quartiers_souhaites: [] }))
              }
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
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="c-pieces" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
              Pièces minimum
            </label>
            <input
              id="c-pieces"
              type="number"
              min={1}
              max={10}
              value={criteres.nb_pieces_min}
              onChange={(e) => setCriteres((c) => ({ ...c, nb_pieces_min: e.target.value }))}
              placeholder="2"
              className={CHAMP}
              style={STYLE_CHAMP}
            />
          </div>
          <div>
            <label htmlFor="c-occ" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
              Occupants
            </label>
            <input
              id="c-occ"
              type="number"
              min={1}
              max={15}
              value={criteres.nb_occupants}
              onChange={(e) => setCriteres((c) => ({ ...c, nb_occupants: e.target.value }))}
              className={CHAMP}
              style={STYLE_CHAMP}
            />
          </div>
        </div>

        <div>
          <label htmlFor="c-date" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
            Emménagement souhaité
          </label>
          <input
            id="c-date"
            type="date"
            value={criteres.date_emmenagement}
            onChange={(e) => setCriteres((c) => ({ ...c, date_emmenagement: e.target.value }))}
            className={CHAMP}
            style={STYLE_CHAMP}
          />
        </div>

        <div>
          <span className="block text-sm font-semibold mb-2" style={{ color: "#334155" }}>
            Quartiers recherchés
          </span>
          <div className="flex flex-wrap gap-2 max-h-52 overflow-y-auto">
            {geo.quartiers.map((q) => {
              const actif = criteres.quartiers_souhaites.includes(q);
              return (
                <button
                  key={q}
                  type="button"
                  onClick={() => basculerQuartier(q)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                  style={{ background: actif ? "#F97316" : "#F0F4FA", color: actif ? "white" : "#64748B" }}
                >
                  {q}
                </button>
              );
            })}
          </div>
        </div>

        <MessageErreur message={enregistrement.erreur} />

        <button
          onClick={enregistrer}
          disabled={enregistrement.enCours}
          className="w-full py-3.5 rounded-2xl font-semibold text-white disabled:opacity-60"
          style={{ background: "#F97316" }}
        >
          {enregistrement.enCours ? "Enregistrement…" : "Enregistrer mes critères"}
        </button>
      </div>
    </>
  );
}

/* ─── Utilitaire d'affichage ───────────────────────────────── */

function InfoLigne({
  icone: Icone,
  label,
  valeur,
}: {
  icone: LucideIcon;
  label: string;
  valeur: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: "#F0F4FA" }}
      >
        <Icone size={16} style={{ color: "#1E3A5F" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-semibold truncate" style={{ color: "#1E293B" }}>
          {valeur}
        </p>
      </div>
    </div>
  );
}

export { InfoLigne };
