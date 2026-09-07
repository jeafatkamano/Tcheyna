import { LogOut, Mail, MapPin, Phone, Star, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { avisAPI, usersAPI } from "../../api";
import { BadgeVerification, VerificationSteps } from "../../components/BadgeVerification";
import { ChangementMotDePasse } from "../../components/ChangementMotDePasse";
import { MessageErreur, MessageSucces } from "../../components/Etats";
import { PhoneVerification } from "../../components/PhoneVerification";
import { useAuth } from "../../context/AuthContext";
import { useAction, useApi } from "../../hooks/useApi";
import { useGeo } from "../../hooks/useGeo";
import { formatRelatif, initiales } from "../../lib/format";
import { InfoLigne } from "../tenant/TenantProfile";

const CHAMP = "w-full px-4 py-3 rounded-xl outline-none";
const STYLE_CHAMP = { background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" };

export function OwnerProfile() {
  const navigate = useNavigate();
  const { user, deconnecter, rafraichir } = useAuth();
  const [succes, setSucces] = useState<string | null>(null);

  const geo = useGeo(user?.pays ?? "Guinée", user?.ville ?? "Conakry");
  const avis = useApi(() => avisAPI.pourUtilisateur(user!.id), [user?.id], { actif: Boolean(user) });

  const [form, setForm] = useState({
    full_name: user?.full_name ?? "",
    bio: user?.bio ?? "",
    ville: user?.ville ?? "Conakry",
    quartier: user?.quartier ?? "",
  });

  const enregistrement = useAction(usersAPI.modifier);

  async function enregistrer() {
    const ok = await enregistrement.executer({
      full_name: form.full_name.trim(),
      bio: form.bio.trim() || undefined,
      ville: form.ville,
      quartier: form.quartier || undefined,
    });
    if (ok) {
      await rafraichir();
      setSucces("Profil mis à jour");
      setTimeout(() => setSucces(null), 3000);
    }
  }

  const niveau = user?.trust_level ?? 0;

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-8" style={{ background: "#1E3A5F" }}>
        <h1 className="text-white font-bold mb-5" style={{ fontSize: "20px" }}>
          Mon profil
        </h1>

        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: "rgba(255,255,255,0.08)" }}
        >
          <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
            {initiales(user?.full_name)}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-lg truncate">{user?.full_name}</h2>
            <p className="text-white/60 text-sm">
              {user?.role === "agency" ? "Agence" : "Propriétaire"}
            </p>
            <div className="mt-2">
              <BadgeVerification level={niveau} size="sm" />
            </div>
          </div>
          {user?.note_moyenne != null && (
            <div className="flex flex-col items-center flex-shrink-0">
              <div className="flex items-center gap-1">
                <Star size={15} style={{ color: "#F59E0B" }} fill="#F59E0B" />
                <span className="text-white font-bold text-lg">{user.note_moyenne}</span>
              </div>
              <span className="text-white/50 text-xs">{user.nb_avis} avis</span>
            </div>
          )}
        </div>
      </div>

      <div className="px-4 pt-5 space-y-5">
        <MessageSucces message={succes} />

        {/* Vérification du téléphone */}
        {!user?.phone_verified && (
          <div
            className="rounded-2xl p-5"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <PhoneVerification onVerifie={() => void rafraichir()} />
          </div>
        )}

        {/* Niveau de confiance */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          <h3 className="font-bold mb-1" style={{ color: "#1E293B" }}>
            Mon niveau de confiance
          </h3>
          <p className="text-xs text-gray-500 mb-4">
            Un profil vérifié rassure les locataires avant même la première visite.
          </p>
          <VerificationSteps niveauActuel={niveau} />
        </div>

        {/* Édition du profil */}
        <div
          className="rounded-2xl p-5 space-y-4"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          <h3 className="font-bold" style={{ color: "#1E293B" }}>
            Informations publiques
          </h3>

          <div>
            <label htmlFor="nom" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
              Nom affiché
            </label>
            <input
              id="nom"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              className={CHAMP}
              style={STYLE_CHAMP}
            />
          </div>

          <div>
            <label htmlFor="bio" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
              Présentation
            </label>
            <textarea
              id="bio"
              rows={3}
              maxLength={500}
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              placeholder="Propriétaire de plusieurs biens à Ratoma. Réponse sous 24 h."
              className={`${CHAMP} resize-none`}
              style={STYLE_CHAMP}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ville" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                Ville
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

          <MessageErreur message={enregistrement.erreur} />

          <button
            onClick={enregistrer}
            disabled={enregistrement.enCours}
            className="w-full py-3.5 rounded-2xl font-semibold text-white disabled:opacity-60"
            style={{ background: "#F97316" }}
          >
            {enregistrement.enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>

        {/* Avis reçus */}
        {avis.data && avis.data.total > 0 && (
          <div
            className="rounded-2xl p-5"
            style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold" style={{ color: "#1E293B" }}>
                Avis reçus
              </h3>
              <div className="flex items-center gap-1">
                <Star size={15} style={{ color: "#F59E0B" }} fill="#F59E0B" />
                <span className="font-bold text-sm" style={{ color: "#1E293B" }}>
                  {avis.data.moyenne}
                </span>
                <span className="text-xs text-gray-400">({avis.data.total})</span>
              </div>
            </div>

            <div className="space-y-3">
              {avis.data.reviews.slice(0, 5).map((review) => (
                <div key={review.id} className="p-3 rounded-xl" style={{ background: "#F8FAFC" }}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-sm" style={{ color: "#1E293B" }}>
                      {review.reviewer?.full_name ?? "Utilisateur"}
                    </span>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          size={12}
                          fill={i < review.note ? "#F59E0B" : "none"}
                          stroke={i < review.note ? "#F59E0B" : "#CBD5E1"}
                        />
                      ))}
                    </div>
                  </div>
                  {review.commentaire && (
                    <p className="text-sm text-gray-600 leading-relaxed">{review.commentaire}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1.5">{formatRelatif(review.created_at)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Compte */}
        <div
          className="rounded-2xl p-5 space-y-3"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          <h3 className="font-bold mb-2" style={{ color: "#1E293B" }}>
            Compte
          </h3>
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
          <InfoLigne
            icone={Users}
            label="Membre depuis"
            valeur={formatRelatif(user?.created_at) || "—"}
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
        </div>
      </div>
    </div>
  );
}
