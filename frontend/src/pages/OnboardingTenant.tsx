/**
 * OnboardingTenant.tsx — Construction du Passeport Locataire, étape par étape.
 *
 * Chaque étape correspond à un palier de confiance réel côté serveur : le
 * parcours ne « simule » rien, il fait progresser le trust_level.
 */
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle,
  FileText,
  Home,
  ShieldCheck,
  Upload,
  User as UserIcon,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { passportAPI, type TypeDocument } from "../api";
import { MessageErreur } from "../components/Etats";
import { PhoneVerification } from "../components/PhoneVerification";
import { ScoreCircle } from "../components/BadgeVerification";
import { useAuth } from "../context/AuthContext";
import { useAction } from "../hooks/useApi";
import { useGeo } from "../hooks/useGeo";
import { RegisterPage } from "./RegisterPage";

const ETAPES = [
  { id: 1, label: "Compte", icone: UserIcon },
  { id: 2, label: "Téléphone", icone: ShieldCheck },
  { id: 3, label: "Recherche", icone: Home },
  { id: 4, label: "Dossier", icone: FileText },
];

const DOCUMENTS: { type: TypeDocument; label: string; aide: string }[] = [
  { type: "cni_recto", label: "CNI — recto", aide: "Carte nationale d'identité, face avant" },
  { type: "cni_verso", label: "CNI — verso", aide: "Face arrière" },
  { type: "income", label: "Justificatif de revenus", aide: "Bulletin de paie, attestation d'employeur ou relevé d'activité" },
];

const SITUATIONS = ["salarié", "indépendant", "commerçant", "fonctionnaire", "étudiant", "autre"];

export function OnboardingTenant() {
  const navigate = useNavigate();
  const { user, rafraichir } = useAuth();

  // Sans compte, l'onboarding commence par l'inscription ; le parcours
  // reprend ensuite à l'étape « Téléphone ».
  if (!user) return <RegisterPage roleImpose="tenant" onInscrit={() => undefined} />;

  return <ParcoursLocataire onTermine={() => navigate("/tenant/dashboard")} rafraichir={rafraichir} />;
}

function ParcoursLocataire({
  onTermine,
  rafraichir,
}: {
  onTermine: () => void;
  rafraichir: () => Promise<unknown>;
}) {
  const { user } = useAuth();
  const [etape, setEtape] = useState(user?.phone_verified ? 3 : 2);
  const [scoreDossier, setScoreDossier] = useState(0);

  const geo = useGeo("Guinée", "Conakry");

  const [criteres, setCriteres] = useState({
    budget_min: "",
    budget_max: "",
    ville_souhaitee: "Conakry",
    quartiers_souhaites: [] as string[],
    type_bien_souhaite: "appartement",
    nb_pieces_min: "2",
    nb_occupants: "1",
  });

  const [situation, setSituation] = useState({
    situation_pro: "salarié",
    employeur: "",
    revenu_mensuel: "",
    a_un_garant: false,
    garant_nom: "",
    garant_revenu: "",
  });

  const [documentsEnvoyes, setDocumentsEnvoyes] = useState<Set<TypeDocument>>(new Set());

  const enregistrementCriteres = useAction(passportAPI.enregistrerCriteres);
  const enregistrementSituation = useAction(passportAPI.mettreAJour);
  const televersement = useAction(passportAPI.televerser);

  function basculerQuartier(quartier: string) {
    setCriteres((c) => ({
      ...c,
      quartiers_souhaites: c.quartiers_souhaites.includes(quartier)
        ? c.quartiers_souhaites.filter((q) => q !== quartier)
        : [...c.quartiers_souhaites, quartier],
    }));
  }

  async function validerCriteres() {
    const reponse = await enregistrementCriteres.executer({
      budget_min: criteres.budget_min ? Number(criteres.budget_min) : undefined,
      budget_max: criteres.budget_max ? Number(criteres.budget_max) : undefined,
      ville_souhaitee: criteres.ville_souhaitee,
      quartiers_souhaites: criteres.quartiers_souhaites,
      type_bien_souhaite: criteres.type_bien_souhaite,
      nb_pieces_min: Number(criteres.nb_pieces_min) || undefined,
      nb_occupants: Number(criteres.nb_occupants) || undefined,
    });
    if (reponse) {
      setScoreDossier(reponse.passport.score);
      setEtape(4);
    }
  }

  async function validerSituation() {
    const reponse = await enregistrementSituation.executer({
      situation_pro: situation.situation_pro,
      employeur: situation.employeur || undefined,
      revenu_mensuel: situation.revenu_mensuel ? Number(situation.revenu_mensuel) : undefined,
      devise: "GNF",
      a_un_garant: situation.a_un_garant,
      garant_nom: situation.a_un_garant ? situation.garant_nom || undefined : undefined,
      garant_revenu:
        situation.a_un_garant && situation.garant_revenu ? Number(situation.garant_revenu) : undefined,
    });
    if (reponse) {
      setScoreDossier(reponse.passport.score);
      await rafraichir();
      onTermine();
    }
  }

  async function televerser(type: TypeDocument, fichier: File) {
    const reponse = await televersement.executer(type, fichier);
    if (reponse) {
      setDocumentsEnvoyes((precedent) => new Set(precedent).add(type));
      setScoreDossier(reponse.score);
      await rafraichir();
    }
  }

  const champ = "w-full px-4 py-3.5 rounded-xl outline-none";
  const styleChamp = { background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F0F4FA" }}>
      {/* En-tête et progression */}
      <div className="px-4 pt-6 pb-6" style={{ background: "#1E3A5F" }}>
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => (etape > 2 ? setEtape(etape - 1) : onTermine())}
            className="p-2 -ml-2 rounded-lg text-white/70 hover:text-white"
            aria-label="Retour"
          >
            <ArrowLeft size={20} />
          </button>
          <span className="text-white font-bold tracking-tight" style={{ fontSize: "18px" }}>
            Passeport Locataire
          </span>
          <button onClick={onTermine} className="text-white/50 text-sm font-medium">
            Plus tard
          </button>
        </div>

        <div className="flex items-center justify-between max-w-sm mx-auto">
          {ETAPES.map((e, index) => {
            const fait = e.id < etape;
            const courante = e.id === etape;
            return (
              <div key={e.id} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-colors"
                    style={{
                      background: fait ? "#10B981" : courante ? "#F97316" : "rgba(255,255,255,0.12)",
                      color: fait || courante ? "white" : "rgba(255,255,255,0.5)",
                    }}
                  >
                    {fait ? <Check size={16} /> : <e.icone size={16} />}
                  </div>
                  <span
                    className="text-xs font-medium"
                    style={{ color: courante ? "#F97316" : "rgba(255,255,255,0.5)" }}
                  >
                    {e.label}
                  </span>
                </div>
                {index < ETAPES.length - 1 && (
                  <div
                    className="flex-1 h-0.5 mx-1 mb-5"
                    style={{ background: fait ? "#10B981" : "rgba(255,255,255,0.12)" }}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-1 px-4 py-6">
        <div className="max-w-sm mx-auto space-y-5">
          {/* ─── Étape 2 : téléphone ─────────────────────── */}
          {etape === 2 && (
            <>
              <div
                className="rounded-2xl p-5"
                style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
              >
                <PhoneVerification onVerifie={() => setEtape(3)} />
              </div>
              <p className="text-center text-xs text-gray-400 leading-relaxed">
                Vérifier votre numéro débloque la recherche, la candidature et la messagerie.
              </p>
            </>
          )}

          {/* ─── Étape 3 : critères de recherche ─────────── */}
          {etape === 3 && (
            <>
              <div>
                <h2 className="font-bold mb-1" style={{ color: "#1E293B", fontSize: "19px" }}>
                  Que cherchez-vous ?
                </h2>
                <p className="text-sm text-gray-500">
                  Ces critères alimentent le matching : plus ils sont précis, plus les annonces
                  proposées vous correspondent.
                </p>
              </div>

              <div
                className="rounded-2xl p-5 space-y-4"
                style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="bmin" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                      Budget min. (GNF)
                    </label>
                    <input
                      id="bmin"
                      type="number"
                      inputMode="numeric"
                      value={criteres.budget_min}
                      onChange={(e) => setCriteres((c) => ({ ...c, budget_min: e.target.value }))}
                      placeholder="1000000"
                      className={champ}
                      style={styleChamp}
                    />
                  </div>
                  <div>
                    <label htmlFor="bmax" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                      Budget max. (GNF)
                    </label>
                    <input
                      id="bmax"
                      type="number"
                      inputMode="numeric"
                      value={criteres.budget_max}
                      onChange={(e) => setCriteres((c) => ({ ...c, budget_max: e.target.value }))}
                      placeholder="3000000"
                      className={champ}
                      style={styleChamp}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="type" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                    Type de bien
                  </label>
                  <select
                    id="type"
                    value={criteres.type_bien_souhaite}
                    onChange={(e) => setCriteres((c) => ({ ...c, type_bien_souhaite: e.target.value }))}
                    className={champ}
                    style={styleChamp}
                  >
                    {geo.typesBien.map((t) => (
                      <option key={t.valeur} value={t.valeur}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pieces" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                      Pièces minimum
                    </label>
                    <input
                      id="pieces"
                      type="number"
                      min={1}
                      max={10}
                      value={criteres.nb_pieces_min}
                      onChange={(e) => setCriteres((c) => ({ ...c, nb_pieces_min: e.target.value }))}
                      className={champ}
                      style={styleChamp}
                    />
                  </div>
                  <div>
                    <label htmlFor="occupants" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
                      Occupants
                    </label>
                    <input
                      id="occupants"
                      type="number"
                      min={1}
                      max={15}
                      value={criteres.nb_occupants}
                      onChange={(e) => setCriteres((c) => ({ ...c, nb_occupants: e.target.value }))}
                      className={champ}
                      style={styleChamp}
                    />
                  </div>
                </div>

                <div>
                  <span className="block text-sm font-semibold mb-2" style={{ color: "#334155" }}>
                    Quartiers recherchés
                  </span>
                  <div className="flex flex-wrap gap-2 max-h-44 overflow-y-auto">
                    {geo.quartiers.map((q) => {
                      const actif = criteres.quartiers_souhaites.includes(q);
                      return (
                        <button
                          key={q}
                          type="button"
                          onClick={() => basculerQuartier(q)}
                          className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
                          style={{
                            background: actif ? "#F97316" : "#F0F4FA",
                            color: actif ? "white" : "#64748B",
                          }}
                        >
                          {q}
                        </button>
                      );
                    })}
                  </div>
                  {criteres.quartiers_souhaites.length > 0 && (
                    <p className="text-xs text-gray-400 mt-2">
                      {criteres.quartiers_souhaites.length} quartier(s) sélectionné(s)
                    </p>
                  )}
                </div>
              </div>

              <MessageErreur message={enregistrementCriteres.erreur} />

              <button
                onClick={validerCriteres}
                disabled={enregistrementCriteres.enCours}
                className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-60"
                style={{ background: "#F97316", fontSize: "16px" }}
              >
                {enregistrementCriteres.enCours ? "Enregistrement…" : "Continuer"}
                <ArrowRight size={18} />
              </button>
            </>
          )}

          {/* ─── Étape 4 : dossier ───────────────────────── */}
          {etape === 4 && (
            <>
              <div className="flex items-start gap-4">
                <div className="flex-1">
                  <h2 className="font-bold mb-1" style={{ color: "#1E293B", fontSize: "19px" }}>
                    Votre dossier
                  </h2>
                  <p className="text-sm text-gray-500">
                    Un dossier complet vous place en tête des candidatures.
                  </p>
                </div>
                <ScoreCircle score={scoreDossier} size={64} />
              </div>

              <div
                className="rounded-2xl p-5 space-y-4"
                style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
              >
                <h3 className="font-bold text-sm" style={{ color: "#1E293B" }}>
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
                    className={champ}
                    style={styleChamp}
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
                    placeholder="Orange Guinée, commerce au marché Madina…"
                    className={champ}
                    style={styleChamp}
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
                    className={champ}
                    style={styleChamp}
                  />
                  <p className="text-xs text-gray-400 mt-1.5">
                    Visible du propriétaire seulement sous forme de niveau de solvabilité.
                  </p>
                </div>

                <div className="flex items-center justify-between py-1">
                  <div>
                    <p className="font-semibold text-sm" style={{ color: "#1E293B" }}>
                      J'ai un garant
                    </p>
                    <p className="text-xs text-gray-400">Rassure le propriétaire</p>
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
                      className={champ}
                      style={styleChamp}
                    />
                    <input
                      type="number"
                      inputMode="numeric"
                      value={situation.garant_revenu}
                      onChange={(e) => setSituation((s) => ({ ...s, garant_revenu: e.target.value }))}
                      placeholder="Revenu (GNF)"
                      aria-label="Revenu du garant"
                      className={champ}
                      style={styleChamp}
                    />
                  </div>
                )}
              </div>

              {/* Documents */}
              <div
                className="rounded-2xl p-5 space-y-3"
                style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
              >
                <h3 className="font-bold text-sm" style={{ color: "#1E293B" }}>
                  Documents justificatifs
                </h3>
                <p className="text-xs text-gray-500 -mt-2">
                  Vérifiés manuellement sous 48 h. Formats acceptés : JPG, PNG, PDF (10 Mo max).
                </p>

                {DOCUMENTS.map((doc) => {
                  const envoye = documentsEnvoyes.has(doc.type);
                  return (
                    <label
                      key={doc.type}
                      className="flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors"
                      style={{
                        background: envoye ? "#ECFDF5" : "#F8FAFC",
                        border: `1.5px solid ${envoye ? "#A7F3D0" : "#E2E8F0"}`,
                      }}
                    >
                      <input
                        type="file"
                        accept=".jpg,.jpeg,.png,.pdf"
                        className="sr-only"
                        onChange={(e) => {
                          const fichier = e.target.files?.[0];
                          if (fichier) void televerser(doc.type, fichier);
                          e.target.value = "";
                        }}
                      />
                      {envoye ? (
                        <CheckCircle size={19} style={{ color: "#10B981", flexShrink: 0 }} />
                      ) : (
                        <Upload size={19} style={{ color: "#94A3B8", flexShrink: 0 }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm" style={{ color: "#1E293B" }}>
                          {doc.label}
                        </p>
                        <p className="text-xs text-gray-400">{envoye ? "Envoyé — en cours d'examen" : doc.aide}</p>
                      </div>
                    </label>
                  );
                })}
              </div>

              <MessageErreur message={enregistrementSituation.erreur ?? televersement.erreur} />

              <button
                onClick={validerSituation}
                disabled={enregistrementSituation.enCours || televersement.enCours}
                className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-60"
                style={{ background: "#F97316", fontSize: "16px" }}
              >
                {enregistrementSituation.enCours ? "Enregistrement…" : "Terminer et voir les annonces"}
                <ArrowRight size={18} />
              </button>

              <Link
                to="/tenant/dashboard"
                className="block text-center text-sm font-medium py-2"
                style={{ color: "#64748B" }}
              >
                Compléter plus tard
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
