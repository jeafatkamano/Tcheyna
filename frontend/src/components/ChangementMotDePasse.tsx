/**
 * ChangementMotDePasse.tsx — Formulaire de changement de mot de passe.
 *
 * Partagé par les espaces locataire, propriétaire et administrateur : le
 * backend expose une seule route, quel que soit le rôle.
 */
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useState } from "react";

import { authAPI } from "../api";
import { useAction } from "../hooks/useApi";
import { MessageErreur, MessageSucces } from "./Etats";

const LONGUEUR_MIN = 8;

const CHAMP = "w-full px-4 py-3 rounded-xl outline-none";
const STYLE_CHAMP = { background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" };

export function ChangementMotDePasse() {
  const [ouvert, setOuvert] = useState(false);
  const [afficher, setAfficher] = useState(false);
  const [succes, setSucces] = useState<string | null>(null);
  const [erreurLocale, setErreurLocale] = useState<string | null>(null);
  const [form, setForm] = useState({ ancien: "", nouveau: "", confirmation: "" });

  const changement = useAction(authAPI.changerMotDePasse);

  function reinitialiser() {
    setForm({ ancien: "", nouveau: "", confirmation: "" });
    setErreurLocale(null);
  }

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreurLocale(null);

    // Vérifié ici plutôt que côté serveur : la confirmation ne le concerne pas.
    if (form.nouveau !== form.confirmation) {
      setErreurLocale("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }
    if (form.nouveau.length < LONGUEUR_MIN) {
      setErreurLocale(`Le nouveau mot de passe doit contenir au moins ${LONGUEUR_MIN} caractères.`);
      return;
    }
    if (form.nouveau === form.ancien) {
      setErreurLocale("Le nouveau mot de passe est identique à l'ancien.");
      return;
    }

    const ok = await changement.executer(form.ancien, form.nouveau);
    if (ok) {
      reinitialiser();
      setOuvert(false);
      setSucces("Mot de passe modifié.");
      setTimeout(() => setSucces(null), 4000);
    }
  }

  if (!ouvert) {
    return (
      <div className="space-y-3">
        <MessageSucces message={succes} />
        <button
          onClick={() => setOuvert(true)}
          className="w-full py-3 rounded-2xl font-semibold flex items-center justify-center gap-2"
          style={{ background: "#F0F4FA", color: "#1E3A5F" }}
        >
          <KeyRound size={17} />
          Changer mon mot de passe
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={soumettre} className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <KeyRound size={17} style={{ color: "#1E3A5F" }} />
        <h4 className="font-bold text-sm" style={{ color: "#1E293B" }}>
          Changer mon mot de passe
        </h4>
      </div>

      <div>
        <label htmlFor="mdp-ancien" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
          Mot de passe actuel
        </label>
        <input
          id="mdp-ancien"
          type="password"
          autoComplete="current-password"
          required
          value={form.ancien}
          onChange={(e) => setForm((f) => ({ ...f, ancien: e.target.value }))}
          className={CHAMP}
          style={STYLE_CHAMP}
        />
      </div>

      <div>
        <label htmlFor="mdp-nouveau" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
          Nouveau mot de passe
        </label>
        <div className="relative">
          <input
            id="mdp-nouveau"
            type={afficher ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={LONGUEUR_MIN}
            value={form.nouveau}
            onChange={(e) => setForm((f) => ({ ...f, nouveau: e.target.value }))}
            placeholder={`${LONGUEUR_MIN} caractères minimum`}
            className={`${CHAMP} pr-11`}
            style={STYLE_CHAMP}
          />
          <button
            type="button"
            onClick={() => setAfficher(!afficher)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2"
            style={{ color: "#94A3B8" }}
            aria-label={afficher ? "Masquer le mot de passe" : "Afficher le mot de passe"}
          >
            {afficher ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="mdp-confirme" className="block text-sm font-semibold mb-1.5" style={{ color: "#334155" }}>
          Confirmer le nouveau mot de passe
        </label>
        <input
          id="mdp-confirme"
          type={afficher ? "text" : "password"}
          autoComplete="new-password"
          required
          value={form.confirmation}
          onChange={(e) => setForm((f) => ({ ...f, confirmation: e.target.value }))}
          className={CHAMP}
          style={STYLE_CHAMP}
        />
      </div>

      <MessageErreur message={erreurLocale ?? changement.erreur} />

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setOuvert(false);
            reinitialiser();
          }}
          className="flex-1 py-3 rounded-2xl font-semibold"
          style={{ background: "#F1F5F9", color: "#64748B" }}
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={changement.enCours}
          className="flex-[2] py-3 rounded-2xl font-semibold text-white disabled:opacity-60"
          style={{ background: "#1E3A5F" }}
        >
          {changement.enCours ? "Modification…" : "Modifier"}
        </button>
      </div>
    </form>
  );
}
