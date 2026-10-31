/**
 * LoginPage.tsx — Connexion (maquette Connexion, lot 3.14).
 *
 * Logique inchangée : e-mail ou numéro vérifié dans le même champ (lot 3.8),
 * motif d'une déconnexion forcée, message après réinitialisation du mot de
 * passe, retour à la page demandée avant la redirection.
 */
import { Capacitor } from "@capacitor/core";
import { Lock, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { effacerMotifDeconnexion, lireMotifDeconnexion } from "../api";
import { MessageErreur, MessageSucces } from "../components/Etats";
import {
  BoutonPrincipal,
  BoutonRetour,
  Champ,
  ChampMotDePasse,
  CLASSE_LIEN,
  EcranSombre,
  LigneLien,
  TEXTE_SECONDAIRE,
  TitreEcran,
} from "../components/FormulaireSombre";
import { Monogramme } from "../components/Marque";
import { useAuth } from "../context/AuthContext";
import { useAction } from "../hooks/useApi";

/** Retour de la page « Mot de passe oublié » après une réinitialisation réussie. */
const MESSAGE_REINITIALISATION =
  "Mot de passe modifié. Vous avez été déconnecté de tous vos appareils.";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { connecter, accueilDuRole } = useAuth();

  // E-mail ou numéro de téléphone vérifié (lot 3.8) : le serveur reconnaît
  // l'un ou l'autre dans le champ `email`, sans contrôle de format ici.
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");

  const connexion = useAction(connecter);
  // Déconnexion forcée (session révoquée, compte désactivé) : on dit pourquoi
  // au lieu d'un renvoi muet. Lu une fois, effacé après affichage.
  const [motif, setMotif] = useState(lireMotifDeconnexion);
  useEffect(() => effacerMotifDeconnexion(), []);

  // Mot de passe réinitialisé : message de succès, qui reçoit le focus.
  const [succes, setSucces] = useState(() =>
    (location.state as { reinitialise?: boolean } | null)?.reinitialise
      ? MESSAGE_REINITIALISATION
      : null,
  );
  const succesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (succes) succesRef.current?.focus();
    // Au chargement seulement : le message ne revient pas une fois effacé.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Retour : page précédente s'il y en a une. Sinon, l'accueil du site ;
  // dans l'application, la connexion est le premier écran : pas de retour.
  const avecHistorique = location.key !== "default";
  const retour = avecHistorique
    ? () => navigate(-1)
    : Capacitor.isNativePlatform()
      ? null
      : () => navigate("/");

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setMotif(null);
    setSucces(null);
    const user = await connexion.executer(identifiant.trim(), motDePasse);
    if (!user) return;
    // Retour à la page demandée avant la redirection, sinon accueil du rôle.
    const destination = (location.state as { from?: string } | null)?.from;
    navigate(destination ?? accueilDuRole(user.role), { replace: true });
  }

  return (
    <EcranSombre>
      <form onSubmit={soumettre} className="flex-1 flex flex-col">
        <div className="h-11 flex items-center justify-between">
          {retour ? <BoutonRetour onClick={retour} /> : <span className="w-11" />}
          <Monogramme taille={26} />
          <span className="w-11" />
        </div>

        <div className="mt-8">
          <TitreEcran sousTitre="Connectez-vous pour retrouver vos annonces et vos mises en relation.">
            Bon retour<span style={{ color: "#F97316" }}>.</span>
          </TitreEcran>
        </div>

        {succes && (
          <div ref={succesRef} tabIndex={-1} className="mt-6 outline-none">
            <MessageSucces message={succes} />
          </div>
        )}

        <div className="mt-7 flex flex-col gap-4">
          {/* type="text" : `type="email"` refuserait un numéro à l'envoi.
              Le clavier e-mail garde l'arobase et une rangée de chiffres. */}
          <Champ
            id="identifiant"
            name="identifiant"
            libelle="E-mail ou téléphone"
            icone={UserRound}
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            value={identifiant}
            onChange={(e) => setIdentifiant(e.target.value)}
            placeholder="vous@exemple.com ou 622 52 92 52"
          />
          <div className="flex flex-col">
            <ChampMotDePasse
              id="mdp"
              libelle="Mot de passe"
              icone={Lock}
              autoComplete="current-password"
              enterKeyHint="go"
              required
              value={motDePasse}
              onChange={(e) => setMotDePasse(e.target.value)}
              placeholder="Votre mot de passe"
            />
            <Link
              to="/mot-de-passe-oublie"
              className="self-end py-2.5 font-semibold underline underline-offset-2"
              style={{ fontSize: 14, color: "rgba(255,255,255,0.8)" }}
            >
              Mot de passe oublié ?
            </Link>
          </div>
          <MessageErreur message={connexion.erreur ?? motif} />
        </div>

        <div className="flex-1 min-h-6" />

        <div className="flex flex-col gap-3">
          <BoutonPrincipal disabled={connexion.enCours}>
            {connexion.enCours ? "Connexion…" : "Se connecter"}
          </BoutonPrincipal>
          <LigneLien>
            Pas encore de compte ?{" "}
            <Link to="/inscription" className={CLASSE_LIEN}>
              Créer un compte
            </Link>
          </LigneLien>
          <p className="m-0 text-center" style={{ fontSize: 12, lineHeight: 1.5, color: TEXTE_SECONDAIRE }}>
            Votre compte reste actif après déconnexion : vos annonces, vos candidatures et vos échanges
            vous attendent.
          </p>
          <div className="pt-3 border-t border-white/10">
            <p className="m-0 mb-3 text-center" style={{ fontSize: 12, color: TEXTE_SECONDAIRE }}>
              Vous découvrez Tcheyna ?
            </p>
            <div className="flex gap-3">
              {[
                { to: "/onboarding/tenant", texte: "Je cherche" },
                { to: "/onboarding/owner", texte: "Je loue" },
              ].map((lien) => (
                <Link
                  key={lien.to}
                  to={lien.to}
                  className="flex-1 h-11 rounded-2xl flex items-center justify-center font-semibold text-white"
                  style={{
                    fontSize: 14,
                    background: "rgba(255,255,255,0.08)",
                    border: "1.5px solid rgba(255,255,255,0.28)",
                  }}
                >
                  {lien.texte}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </form>
    </EcranSombre>
  );
}
