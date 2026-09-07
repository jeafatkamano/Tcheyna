/**
 * TenantProfileView.tsx — Profil public d'un utilisateur.
 *
 * Sert aussi bien à consulter le dossier d'un candidat (côté propriétaire) que
 * la réputation d'un bailleur (côté locataire). Les données financières brutes
 * ne sont jamais exposées : le backend renvoie une vue publique.
 */
import {
  ArrowLeft,
  Briefcase,
  Calendar,
  Home,
  MapPin,
  Star,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate, useParams } from "react-router";

import { usersAPI } from "../../api";
import { Avatar } from "../../components/Avatar";
import { BadgeVerification, ScoreCircle } from "../../components/BadgeVerification";
import { Chargement, Erreur } from "../../components/Etats";
import { ListingCard } from "../../components/ListingCard";
import { formatDate, formatMontantCourt, labelTypeBien } from "../../lib/format";
import { useApi } from "../../hooks/useApi";

export function TenantProfileView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const profil = useApi(() => usersAPI.profil(id!), [id], { actif: Boolean(id) });

  if (profil.chargement) return <Chargement texte="Chargement du profil…" />;

  if (profil.erreur || !profil.data) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "#F0F4FA" }}>
        <div className="px-4 pt-6">
          <button onClick={() => navigate(-1)} className="p-2 -ml-2" style={{ color: "#1E3A5F" }}>
            <ArrowLeft size={20} />
          </button>
        </div>
        <Erreur message={profil.erreur ?? "Profil introuvable"} onReessayer={profil.recharger} />
      </div>
    );
  }

  const utilisateur = profil.data;
  const passeport = utilisateur.passeport;
  const estLocataire = utilisateur.role === "tenant";

  return (
    <div className="pb-8">
      {/* En-tête */}
      <div className="px-4 pt-6 pb-8" style={{ background: "#1E3A5F" }}>
        <button
          onClick={() => navigate(-1)}
          className="p-2 -ml-2 mb-4 rounded-lg text-white/70 hover:text-white"
          aria-label="Retour"
        >
          <ArrowLeft size={20} />
        </button>

        <div className="flex items-center gap-4">
          <Avatar
            nom={utilisateur.full_name}
            url={utilisateur.avatar_url}
            taille={64}
            surFonce
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-white font-bold text-lg truncate">{utilisateur.full_name}</h1>
            <p className="text-white/60 text-sm">
              {
                { tenant: "Locataire", landlord: "Propriétaire", agency: "Agence", admin: "Équipe Tcheyna" }[
                  utilisateur.role
                ]
              }
              {utilisateur.quartier && ` · ${utilisateur.quartier}`}
            </p>
            <div className="mt-2">
              <BadgeVerification level={utilisateur.trust_level} size="sm" />
            </div>
          </div>
          {estLocataire && passeport && <ScoreCircle score={passeport.score} size={64} />}
        </div>

        {utilisateur.note_moyenne != null && (
          <div
            className="mt-5 rounded-2xl p-4 flex items-center gap-3"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            <Star size={22} style={{ color: "#F59E0B" }} fill="#F59E0B" />
            <div>
              <p className="text-white font-bold text-lg leading-none">
                {utilisateur.note_moyenne} <span className="text-sm font-normal text-white/50">/ 5</span>
              </p>
              <p className="text-white/50 text-xs mt-1">
                sur {utilisateur.nb_avis} avis d'anciens partenaires
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pt-5 space-y-5">
        {/* Présentation */}
        {utilisateur.bio && (
          <div
            className="rounded-2xl p-5"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold mb-2" style={{ color: "#1E293B" }}>
              Présentation
            </h2>
            <p className="text-gray-600 text-sm leading-relaxed">{utilisateur.bio}</p>
          </div>
        )}

        {/* Dossier locataire (vue publique) */}
        {estLocataire && passeport && (
          <div
            className="rounded-2xl p-5"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold mb-4" style={{ color: "#1E293B" }}>
              Dossier locataire
            </h2>

            <div className="space-y-3">
              <Info
                icone={Briefcase}
                label="Situation professionnelle"
                valeur={
                  passeport.situation_pro
                    ? passeport.situation_pro.charAt(0).toUpperCase() + passeport.situation_pro.slice(1)
                    : "Non précisée"
                }
              />
              <Info
                icone={Wallet}
                label="Budget recherché"
                valeur={
                  passeport.budget_max
                    ? `${passeport.budget_min ? `${formatMontantCourt(passeport.budget_min)} – ` : "jusqu'à "}${formatMontantCourt(passeport.budget_max)} /mois`
                    : "Non précisé"
                }
              />
              <Info
                icone={Home}
                label="Type de bien"
                valeur={
                  passeport.type_bien_souhaite
                    ? `${labelTypeBien(passeport.type_bien_souhaite)}${passeport.nb_pieces_min ? ` · ${passeport.nb_pieces_min} pièces min.` : ""}`
                    : "Non précisé"
                }
              />
              <Info
                icone={MapPin}
                label="Quartiers recherchés"
                valeur={passeport.quartiers_souhaites.join(", ") || "Non précisés"}
              />
              <Info
                icone={Users}
                label="Occupants"
                valeur={`${passeport.nb_occupants ?? 1} personne${(passeport.nb_occupants ?? 1) > 1 ? "s" : ""}${passeport.a_un_garant ? " · avec garant" : ""}`}
              />
              {passeport.date_emmenagement && (
                <Info
                  icone={Calendar}
                  label="Emménagement souhaité"
                  valeur={formatDate(passeport.date_emmenagement)}
                />
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-2 gap-3">
              <Verification label="Identité vérifiée" ok={utilisateur.cni_verified} />
              <Verification label="Revenus justifiés" ok={utilisateur.income_verified} />
            </div>
          </div>
        )}

        {/* Annonces du bailleur */}
        {utilisateur.annonces && utilisateur.annonces.length > 0 && (
          <div>
            <h2 className="font-bold mb-3" style={{ color: "#1E293B", fontSize: "17px" }}>
              Ses annonces ({utilisateur.nb_annonces})
            </h2>
            <div className="space-y-4">
              {utilisateur.annonces.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          </div>
        )}

        {/* Avis */}
        {utilisateur.avis && utilisateur.avis.length > 0 && (
          <div
            className="rounded-2xl p-5"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <h2 className="font-bold mb-4" style={{ color: "#1E293B" }}>
              Avis reçus
            </h2>
            <div className="space-y-3">
              {utilisateur.avis.map((avis) => (
                <div key={avis.id} className="p-3.5 rounded-xl" style={{ background: "#F8FAFC" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-sm" style={{ color: "#1E293B" }}>
                      {avis.reviewer?.full_name ?? "Utilisateur"}
                    </span>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          size={12}
                          fill={i < avis.note ? "#F59E0B" : "none"}
                          stroke={i < avis.note ? "#F59E0B" : "#CBD5E1"}
                        />
                      ))}
                    </div>
                  </div>
                  {avis.commentaire && (
                    <p className="text-sm text-gray-600 leading-relaxed">{avis.commentaire}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1.5">{formatDate(avis.created_at)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {(!utilisateur.avis || utilisateur.avis.length === 0) && (
          <p className="text-center text-sm text-gray-400 py-4">
            Aucun avis pour l'instant — ce profil débute sur Tcheyna.
          </p>
        )}
      </div>
    </div>
  );
}

function Info({ icone: Icone, label, valeur }: { icone: LucideIcon; label: string; valeur: string }) {
  return (
    <div className="flex items-start gap-3">
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: "#F0F4FA" }}
      >
        <Icone size={16} style={{ color: "#1E3A5F" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-sm font-semibold" style={{ color: "#1E293B" }}>
          {valeur}
        </p>
      </div>
    </div>
  );
}

function Verification({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div
      className="px-3 py-2.5 rounded-xl text-center"
      style={{ background: ok ? "#ECFDF5" : "#F8FAFC" }}
    >
      <p className="text-xs font-semibold" style={{ color: ok ? "#059669" : "#94A3B8" }}>
        {ok ? "✓ " : "— "}
        {label}
      </p>
    </div>
  );
}
