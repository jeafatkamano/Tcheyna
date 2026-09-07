/**
 * AdminDashboard.tsx — File de vérification.
 *
 * C'est ici que se construit l'actif de confiance : pièces d'identité,
 * justificatifs de revenus et certification des annonces.
 */
import {
  Check,
  FileText,
  Home,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { adminAPI, urlFichier, type Listing } from "../../api";
import { Avatar } from "../../components/Avatar";
import { BadgeVerification } from "../../components/BadgeVerification";
import { ChangementMotDePasse } from "../../components/ChangementMotDePasse";
import { Chargement, Erreur, ListeVide, MessageErreur, MessageSucces } from "../../components/Etats";
import { useAction, useApi } from "../../hooks/useApi";
import { formatMontant, formatMontantCourt, formatRelatif } from "../../lib/format";

type Onglet = "identites" | "revenus" | "annonces";

export function AdminDashboard() {
  const [onglet, setOnglet] = useState<Onglet>("identites");
  const [succes, setSucces] = useState<string | null>(null);

  const stats = useApi(() => adminAPI.stats(), []);
  const cni = useApi(() => adminAPI.cniEnAttente(), []);
  const revenus = useApi(() => adminAPI.revenusEnAttente(), []);
  const certifications = useApi(() => adminAPI.certificationsEnAttente(), []);

  const validationCNI = useAction(adminAPI.validerCNI);
  const validationRevenus = useAction(adminAPI.validerRevenus);
  const certification = useAction(adminAPI.certifier);

  function confirmer(message: string) {
    setSucces(message);
    setTimeout(() => setSucces(null), 3000);
    void stats.recharger();
  }

  const file = stats.data?.file_de_verification;

  const ONGLETS = [
    { cle: "identites" as const, label: "Identités", compteur: file?.cni_en_attente ?? 0 },
    { cle: "revenus" as const, label: "Revenus", compteur: file?.revenus_en_attente ?? 0 },
    { cle: "annonces" as const, label: "Annonces", compteur: file?.annonces_en_attente ?? 0 },
  ];

  return (
    <div className="pb-8">
      {/* Statistiques */}
      <div className="px-4 pt-6 pb-6" style={{ background: "#1E3A5F" }}>
        <h1 className="text-white font-bold mb-1" style={{ fontSize: "20px" }}>
          Back-office Tcheyna
        </h1>
        <p className="text-white/60 text-sm mb-5">File de vérification et indicateurs</p>

        {stats.chargement ? (
          <Chargement texte="" />
        ) : stats.data ? (
          <>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { label: "Utilisateurs", valeur: stats.data.utilisateurs.total, icone: Users, couleur: "#F97316" },
                { label: "Annonces", valeur: stats.data.annonces.actives, icone: Home, couleur: "#3B82F6" },
                { label: "Certifiées", valeur: stats.data.annonces.certifiees, icone: ShieldCheck, couleur: "#10B981" },
                { label: "Locations", valeur: stats.data.mises_en_relation.conclues, icone: TrendingUp, couleur: "#8B5CF6" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl p-3 flex flex-col items-center text-center"
                  style={{ background: "rgba(255,255,255,0.08)" }}
                >
                  <s.icone size={17} style={{ color: s.couleur }} />
                  <span className="text-white font-bold text-lg mt-1">{s.valeur}</span>
                  <span className="text-white/50 text-xs leading-tight">{s.label}</span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(249,115,22,0.2)" }}
              >
                <Wallet size={20} style={{ color: "#F97316" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white/60 text-xs">Encaissé via la plateforme</p>
                <p className="text-white font-bold text-lg">
                  {formatMontant(stats.data.revenus.total_encaisse, stats.data.revenus.devise)}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-white/60 text-xs">Commissions</p>
                <p className="text-white font-semibold text-sm">
                  {formatMontantCourt(stats.data.revenus.commissions, stats.data.revenus.devise)}
                </p>
              </div>
            </div>

            <Link
              to="/admin/users"
              className="mt-3 block text-center py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: "rgba(255,255,255,0.08)", color: "#F97316" }}
            >
              Gérer les utilisateurs
            </Link>
          </>
        ) : (
          <p className="text-white/60 text-sm">{stats.erreur}</p>
        )}
      </div>

      {/* Onglets */}
      <div className="px-4 -mt-3 relative z-10">
        <div
          className="flex gap-1 p-1 rounded-2xl"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.1)" }}
        >
          {ONGLETS.map((o) => (
            <button
              key={o.cle}
              onClick={() => setOnglet(o.cle)}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-1.5"
              style={{
                background: onglet === o.cle ? "#F97316" : "transparent",
                color: onglet === o.cle ? "white" : "#64748B",
              }}
            >
              {o.label}
              {o.compteur > 0 && (
                <span
                  className="min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center font-bold"
                  style={{
                    background: onglet === o.cle ? "rgba(255,255,255,0.3)" : "#FEE2E2",
                    color: onglet === o.cle ? "white" : "#DC2626",
                    fontSize: "10px",
                  }}
                >
                  {o.compteur}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-5 space-y-4">
        <MessageSucces message={succes} />
        <MessageErreur
          message={validationCNI.erreur ?? validationRevenus.erreur ?? certification.erreur}
        />

        {/* ─── Identités ─────────────────────────────────── */}
        {onglet === "identites" &&
          (cni.chargement ? (
            <Chargement />
          ) : cni.erreur ? (
            <Erreur message={cni.erreur} onReessayer={cni.recharger} />
          ) : !cni.data?.length ? (
            <ListeVide titre="Aucune pièce d'identité en attente" description="La file est vide." />
          ) : (
            cni.data.map(({ user, passport }) => (
              <FicheVerification
                key={user.id}
                titre={user.full_name}
                sousTitre={`${user.email} · ${user.phone ?? "sans téléphone"}`}
                niveau={user.trust_level}
                documents={[
                  { label: "CNI recto", present: passport?.documents?.cni_recto },
                  { label: "CNI verso", present: passport?.documents?.cni_verso },
                  { label: "Passeport", present: passport?.documents?.passport },
                ]}
                lienProfil={`/profil/${user.id}`}
                enCours={validationCNI.enCours}
                onValider={async (approuve, motif) => {
                  const ok = await validationCNI.executer(user.id, approuve, motif);
                  if (ok) {
                    void cni.recharger();
                    confirmer(approuve ? "Identité validée" : "Identité refusée");
                  }
                }}
              />
            ))
          ))}

        {/* ─── Revenus ───────────────────────────────────── */}
        {onglet === "revenus" &&
          (revenus.chargement ? (
            <Chargement />
          ) : revenus.erreur ? (
            <Erreur message={revenus.erreur} onReessayer={revenus.recharger} />
          ) : !revenus.data?.length ? (
            <ListeVide titre="Aucun justificatif de revenus en attente" description="La file est vide." />
          ) : (
            revenus.data.map(({ passport, user }) => (
              <FicheVerification
                key={passport.id}
                titre={user?.full_name ?? "Locataire"}
                sousTitre={`${passport.situation_pro ?? "Situation non précisée"}${
                  passport.employeur ? ` · ${passport.employeur}` : ""
                }`}
                niveau={user?.trust_level ?? 0}
                complement={
                  passport.revenu_mensuel
                    ? `Revenu déclaré : ${formatMontant(passport.revenu_mensuel, passport.devise ?? "GNF")}`
                    : "Revenu non déclaré"
                }
                documents={[{ label: "Justificatif de revenus", present: passport.documents?.income }]}
                lienProfil={user ? `/profil/${user.id}` : undefined}
                enCours={validationRevenus.enCours}
                onValider={async (approuve, motif) => {
                  if (!user) return;
                  const ok = await validationRevenus.executer(user.id, approuve, motif);
                  if (ok) {
                    void revenus.recharger();
                    confirmer(approuve ? "Revenus validés" : "Revenus refusés");
                  }
                }}
              />
            ))
          ))}

        {/* ─── Certification d'annonces ──────────────────── */}
        {onglet === "annonces" &&
          (certifications.chargement ? (
            <Chargement />
          ) : certifications.erreur ? (
            <Erreur message={certifications.erreur} onReessayer={certifications.recharger} />
          ) : !certifications.data?.length ? (
            <ListeVide titre="Aucune demande de certification" description="La file est vide." />
          ) : (
            certifications.data.map((listing) => (
              <FicheCertification
                key={listing.id}
                listing={listing}
                enCours={certification.enCours}
                onValider={async (approuve, motif) => {
                  const ok = await certification.executer(listing.id, approuve, motif);
                  if (ok) {
                    void certifications.recharger();
                    confirmer(approuve ? "Annonce certifiée" : "Certification refusée");
                  }
                }}
              />
            ))
          ))}

        {/* Compte administrateur */}
        <div
          className="rounded-2xl p-5 mt-2"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          <h3 className="font-bold mb-3" style={{ color: "#1E293B" }}>
            Mon compte
          </h3>
          <ChangementMotDePasse />
        </div>
      </div>
    </div>
  );
}

/* ─── Fiche de vérification d'un utilisateur ───────────────── */

interface FicheProps {
  titre: string;
  sousTitre: string;
  niveau: number;
  complement?: string;
  documents: { label: string; present?: boolean }[];
  lienProfil?: string;
  enCours: boolean;
  onValider: (approuve: boolean, motif?: string) => Promise<void>;
}

function FicheVerification({
  titre,
  sousTitre,
  niveau,
  complement,
  documents,
  lienProfil,
  enCours,
  onValider,
}: FicheProps) {
  const [refusOuvert, setRefusOuvert] = useState(false);
  const [motif, setMotif] = useState("");

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
    >
      <div className="flex items-center gap-3 mb-3">
        <Avatar nom={titre} taille={44} />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-sm truncate" style={{ color: "#1E293B" }}>
            {titre}
          </p>
          <p className="text-xs text-gray-400 truncate">{sousTitre}</p>
        </div>
        <BadgeVerification level={niveau} size="sm" />
      </div>

      {complement && (
        <p className="text-sm font-semibold mb-3" style={{ color: "#1E3A5F" }}>
          {complement}
        </p>
      )}

      <div className="flex flex-wrap gap-2 mb-3">
        {documents.map((doc) => (
          <span
            key={doc.label}
            className="px-2.5 py-1 rounded-full text-xs font-semibold"
            style={{
              background: doc.present ? "#D1FAE5" : "#F1F5F9",
              color: doc.present ? "#059669" : "#94A3B8",
            }}
          >
            {doc.present ? "✓ " : "— "}
            {doc.label}
          </span>
        ))}
      </div>

      {lienProfil && (
        <Link
          to={lienProfil}
          className="block text-center py-2 rounded-xl text-xs font-semibold mb-3"
          style={{ background: "#F0F4FA", color: "#1E3A5F" }}
        >
          Voir le profil complet
        </Link>
      )}

      {refusOuvert ? (
        <div className="space-y-2">
          <textarea
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            rows={2}
            placeholder="Motif du refus (communiqué à l'utilisateur)"
            aria-label="Motif du refus"
            className="w-full px-3.5 py-2.5 rounded-xl outline-none resize-none"
            style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "14px" }}
          />
          <div className="flex gap-2">
            <button
              onClick={() => {
                setRefusOuvert(false);
                setMotif("");
              }}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
              style={{ background: "#F1F5F9", color: "#64748B" }}
            >
              Annuler
            </button>
            <button
              onClick={() => onValider(false, motif.trim() || undefined)}
              disabled={enCours}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#DC2626" }}
            >
              Confirmer le refus
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => setRefusOuvert(true)}
            disabled={enCours}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
            style={{ background: "#FEE2E2", color: "#DC2626" }}
          >
            <X size={15} />
            Refuser
          </button>
          <button
            onClick={() => onValider(true)}
            disabled={enCours}
            className="flex-[2] flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "#10B981" }}
          >
            <Check size={15} />
            Valider
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Fiche de certification d'annonce ─────────────────────── */

function FicheCertification({
  listing,
  enCours,
  onValider,
}: {
  listing: Listing & { propriete_doc_url?: string; demande_le?: string };
  enCours: boolean;
  onValider: (approuve: boolean, motif?: string) => Promise<void>;
}) {
  const [refusOuvert, setRefusOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const doc = urlFichier(listing.propriete_doc_url);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
    >
      {listing.images[0] && (
        <img src={listing.images[0]} alt="" className="w-full h-36 object-cover" />
      )}

      <div className="p-4">
        <p className="font-bold text-sm mb-1" style={{ color: "#1E293B" }}>
          {listing.title}
        </p>
        <p className="text-xs text-gray-400 mb-2">
          {listing.quartier ?? listing.ville} · {formatMontantCourt(listing.prix, listing.devise)}/mois ·{" "}
          {listing.images.length} photo{listing.images.length > 1 ? "s" : ""}
        </p>
        <p className="text-xs text-gray-400 mb-3">
          Par {listing.landlord?.full_name ?? "propriétaire"} · demandé{" "}
          {formatRelatif(listing.demande_le)}
        </p>

        <div className="flex gap-2 mb-3">
          <Link
            to={`/listing/${listing.id}`}
            className="flex-1 text-center py-2 rounded-xl text-xs font-semibold"
            style={{ background: "#F0F4FA", color: "#1E3A5F" }}
          >
            Voir l'annonce
          </Link>
          {doc && (
            <a
              href={doc}
              target="_blank"
              rel="noreferrer"
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold"
              style={{ background: "#EFF6FF", color: "#1D4ED8" }}
            >
              <FileText size={13} />
              Document de propriété
            </a>
          )}
        </div>

        {refusOuvert ? (
          <div className="space-y-2">
            <textarea
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              rows={2}
              placeholder="Motif du refus (obligatoire, communiqué au propriétaire)"
              aria-label="Motif du refus"
              className="w-full px-3.5 py-2.5 rounded-xl outline-none resize-none"
              style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "14px" }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setRefusOuvert(false);
                  setMotif("");
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: "#F1F5F9", color: "#64748B" }}
              >
                Annuler
              </button>
              <button
                onClick={() => onValider(false, motif.trim())}
                disabled={enCours || !motif.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#DC2626" }}
              >
                Confirmer le refus
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setRefusOuvert(true)}
              disabled={enCours}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
              style={{ background: "#FEE2E2", color: "#DC2626" }}
            >
              <X size={15} />
              Refuser
            </button>
            <button
              onClick={() => onValider(true)}
              disabled={enCours}
              className="flex-[2] flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#10B981" }}
            >
              <ShieldCheck size={15} />
              Certifier l'annonce
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
