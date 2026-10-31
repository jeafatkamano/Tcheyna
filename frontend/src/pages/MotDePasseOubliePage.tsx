/**
 * MotDePasseOubliePage.tsx — Mot de passe oublié, par SMS (lot 3.8 ; maquette MotDePasse et code en six cases, lot 3.14).
 *
 * Deux étapes :
 *   1. le numéro → POST /auth/mot-de-passe-oublie. La réponse est la même que
 *      le numéro corresponde à un compte ou non : son message, neutre, est
 *      affiché tel quel. Un compte à rebours de 60 s (l'anti-spam du serveur)
 *      précède toute nouvelle demande ;
 *   2. le code reçu + le nouveau mot de passe → POST
 *      /auth/mot-de-passe-oublie/confirmer.
 *
 * En cas de succès, le serveur ferme toutes les sessions du compte, sur tous
 * les appareils, sans en ouvrir de nouvelle : la session locale éventuelle
 * est vidée (`deconnecter` du contexte), puis retour à la connexion.
 *
 * Erreurs : 400 et 429 affichent le message du serveur tel quel (le 429 bloque
 * en plus le bouton pendant `reessayer_dans`), 422 place `details` sous les
 * champs concernés, 404 signale un serveur qui ne connaît pas encore la route.
 */
import { Info, KeyRound, Lock, Smartphone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ApiError, authAPI, tokens } from "../api";
import { MessageErreur } from "../components/Etats";
import {
  BoutonPrincipal,
  BoutonRetour,
  Champ,
  ChampMotDePasse,
  CLASSE_LIEN,
  EcranSombre,
  Encadre,
  ErreurChamp,
  IconeEcran,
  LigneLien,
  TEXTE_SECONDAIRE,
  TitreEcran,
} from "../components/FormulaireSombre";
import { SaisieCode } from "../components/SaisieCode";
import { decritPar } from "../lib/aria";
import { useAuth } from "../context/AuthContext";

/** Règle du serveur (`MotDePasse` : 8 à 128 caractères). */
const LONGUEUR_MIN = 8;
/** Anti-spam du serveur entre deux codes envoyés au même compte. */
const ATTENTE_RENVOI_S = 60;

const MESSAGE_INDISPONIBLE =
  "La récupération par SMS n'est pas encore disponible. Réessayez plus tard.";

type Champ = "phone" | "code" | "nouveau_mot_de_passe" | "confirmation";
type ErreursChamps = Partial<Record<Champ, string>>;

/** Champs du serveur affichés à chaque étape. */
const CHAMPS_ETAPE = {
  numero: ["phone"],
  code: ["code", "nouveau_mot_de_passe"],
} as const satisfies Record<string, readonly Champ[]>;

/**
 * Erreur à afficher : message général et, pour un 422, messages sous les
 * champs visibles. Un détail sur un champ absent de l'étape (le numéro, à
 * l'étape 2) laisse le message général du serveur.
 */
function analyserErreur(
  err: unknown,
  visibles: readonly Champ[],
): { general: string | null; champs: ErreursChamps } {
  if (!(err instanceof ApiError)) return { general: "Une erreur est survenue", champs: {} };
  if (err.statut === 404) return { general: MESSAGE_INDISPONIBLE, champs: {} };
  if (err.statut !== 422) return { general: err.message, champs: {} };

  // 422 : `details` = [{ champ, code, message }] (format commun du serveur).
  const details = (err.details as { details?: unknown } | null)?.details;
  const champs: ErreursChamps = {};
  let horsChamp = false;
  for (const detail of Array.isArray(details) ? details : []) {
    const { champ, message } = (detail ?? {}) as { champ?: unknown; message?: unknown };
    const visible = typeof champ === "string" && (visibles as readonly string[]).includes(champ);
    if (visible && typeof message === "string") {
      champs[champ as Champ] ??= message;
    } else {
      horsChamp = true;
    }
  }
  const aucunChamp = Object.keys(champs).length === 0;
  return { general: aucunChamp || horsChamp ? err.message : null, champs };
}

/** Délai imposé par un 429 (`reessayer_dans`, en secondes), sinon null. */
function delaiImpose(err: unknown): number | null {
  if (!(err instanceof ApiError) || err.statut !== 429) return null;
  const secondes = (err.details as { reessayer_dans?: unknown } | null)?.reessayer_dans;
  return typeof secondes === "number" && secondes > 0 ? Math.ceil(secondes) : null;
}

function formaterAttente(secondes: number) {
  return secondes > 90 ? `${Math.ceil(secondes / 60)} min` : `${secondes} s`;
}

/**
 * Décompte à la seconde, calculé sur l'heure de fin : un onglet mis en
 * arrière-plan (minuteries ralenties par le navigateur) retrouve la bonne
 * valeur à son retour. `duree` garde la valeur de départ.
 */
function useCompteARebours() {
  const [fin, setFin] = useState(0);
  const [duree, setDuree] = useState(0);
  const [maintenant, setMaintenant] = useState(() => Date.now());
  const restant = Math.max(0, Math.ceil((fin - maintenant) / 1000));
  const actif = restant > 0;
  useEffect(() => {
    if (!actif) return;
    const minuterie = setInterval(() => setMaintenant(Date.now()), 1000);
    return () => clearInterval(minuterie);
  }, [actif]);
  return {
    restant,
    duree,
    demarrer(secondes: number) {
      const debut = Date.now();
      setMaintenant(debut);
      setFin(debut + secondes * 1000);
      setDuree(secondes);
    },
  };
}

export function MotDePasseOubliePage() {
  const navigate = useNavigate();
  const { user, deconnecter } = useAuth();

  const [etape, setEtape] = useState<"numero" | "code">("numero");
  const [phone, setPhone] = useState("");
  const [messageEnvoi, setMessageEnvoi] = useState<string | null>(null);
  const [expireDans, setExpireDans] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [nouveau, setNouveau] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [afficherMdp, setAfficherMdp] = useState(false);

  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreursChamps, setErreursChamps] = useState<ErreursChamps>({});

  const renvoi = useCompteARebours();
  const attenteConfirmation = useCompteARebours();

  const titreCodeRef = useRef<HTMLHeadingElement>(null);
  const champNumeroRef = useRef<HTMLInputElement>(null);
  // Le focus ne bouge qu'après un changement d'étape, jamais au chargement.
  const etapeChangee = useRef(false);
  useEffect(() => {
    if (!etapeChangee.current) return;
    if (etape === "code") titreCodeRef.current?.focus();
    else champNumeroRef.current?.focus();
  }, [etape]);

  function changerEtape(suivante: "numero" | "code") {
    etapeChangee.current = true;
    setErreur(null);
    setErreursChamps({});
    setEtape(suivante);
  }

  function afficherErreur(err: unknown, attente: ReturnType<typeof useCompteARebours>) {
    const { general, champs } = analyserErreur(err, CHAMPS_ETAPE[etape]);
    setErreur(general);
    setErreursChamps(champs);
    const delai = delaiImpose(err);
    if (delai) attente.demarrer(delai);
  }

  async function demanderCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (enCours || renvoi.restant > 0) return;
    setErreur(null);
    setErreursChamps({});
    if (!phone.trim()) {
      setErreursChamps({ phone: "Saisissez votre numéro de téléphone." });
      return;
    }
    setEnCours(true);
    try {
      const reponse = await authAPI.demanderReinitialisation(phone.trim());
      setMessageEnvoi(reponse.message);
      setExpireDans(reponse.expire_dans ?? null);
      renvoi.demarrer(ATTENTE_RENVOI_S);
      if (etape !== "code") changerEtape("code");
    } catch (err) {
      afficherErreur(err, renvoi);
    } finally {
      setEnCours(false);
    }
  }

  async function confirmer(e: React.FormEvent) {
    e.preventDefault();
    if (enCours || attenteConfirmation.restant > 0) return;
    setErreur(null);

    // Contrôles locaux, sans appel : le serveur ne voit pas la confirmation.
    const locales: ErreursChamps = {};
    if (!/^\d{6}$/.test(code)) locales.code = "Le code doit comporter 6 chiffres.";
    if (nouveau.length < LONGUEUR_MIN) {
      locales.nouveau_mot_de_passe = `Au moins ${LONGUEUR_MIN} caractères.`;
    }
    if (nouveau !== confirmation) {
      locales.confirmation = "Les deux mots de passe ne correspondent pas.";
    }
    setErreursChamps(locales);
    if (Object.keys(locales).length > 0) return;

    setEnCours(true);
    try {
      await authAPI.confirmerReinitialisation(phone.trim(), code, nouveau);
    } catch (err) {
      afficherErreur(err, attenteConfirmation);
      setEnCours(false);
      return;
    }
    // Le serveur a révoqué tous les jetons du compte : ceux de cet appareil
    // ne valent plus rien. Sans cela, /login renverrait vers l'espace.
    if (user || tokens.access() || tokens.refresh()) deconnecter();
    navigate("/login", { replace: true, state: { reinitialise: true } });
  }

  const libelleRenvoi =
    renvoi.restant > 0 ? ` (dans ${formaterAttente(renvoi.restant)})` : "";
  // Annonce discrète : au départ et à la fin du décompte, pas à chaque seconde.
  const annonceRenvoi =
    renvoi.restant > 0
      ? `Vous pourrez demander un nouveau code dans ${formaterAttente(renvoi.duree)}.`
      : renvoi.duree > 0
        ? "Vous pouvez demander un nouveau code."
        : "";

  return (
    <EcranSombre>
      <p className="sr-only" aria-live="polite">
        {annonceRenvoi}
      </p>

      {etape === "numero" ? (
        <form onSubmit={demanderCode} className="flex-1 flex flex-col" noValidate>
          <div className="h-11 flex items-center">
            <BoutonRetour onClick={() => navigate("/login")} libelle="Retour à la connexion" />
          </div>
          <div className="mt-6">
            <IconeEcran icone={KeyRound} />
          </div>
          <div className="mt-6">
            <TitreEcran taille={30} sousTitre="Recevez par SMS un code pour choisir un nouveau mot de passe.">
              Mot de passe oublié
            </TitreEcran>
          </div>

          <div className="mt-8">
            <Champ
              ref={champNumeroRef}
              id="phone"
              libelle="Numéro de téléphone"
              prefixe="+224"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="send"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="622 52 92 52"
              aide="Indicatif +224 ajouté automatiquement pour la Guinée."
              erreur={erreursChamps.phone}
            />
          </div>

          <div className="mt-5">
            <Encadre icone={Info}>
              Seul un numéro <strong className="text-white">vérifié</strong> permet de récupérer votre compte.
              Une fois connecté, pensez à vérifier votre numéro depuis votre profil.
            </Encadre>
          </div>

          <div className="mt-4">
            <MessageErreur message={erreur} />
          </div>

          <div className="flex-1 min-h-8" />

          <div className="flex flex-col gap-3.5">
            <BoutonPrincipal disabled={enCours || renvoi.restant > 0}>
              {enCours ? "Envoi…" : `Recevoir un code par SMS${libelleRenvoi}`}
            </BoutonPrincipal>
            <LigneLien>
              Vous vous en souvenez ?{" "}
              <Link to="/login" className={CLASSE_LIEN}>
                Se connecter
              </Link>
            </LigneLien>
          </div>
        </form>
      ) : (
        <form onSubmit={confirmer} className="flex-1 flex flex-col" noValidate>
          <div className="h-11 flex items-center">
            <BoutonRetour
              onClick={() => {
                setCode("");
                changerEtape("numero");
              }}
              libelle="Modifier le numéro"
            />
          </div>
          <div className="mt-6">
            <IconeEcran icone={Smartphone} />
          </div>
          <div className="mt-6 flex flex-col gap-2.5">
            <h1 className="m-0 font-extrabold" style={{ fontSize: 30, lineHeight: 1.12, letterSpacing: -0.5 }}>
              Mot de passe oublié
            </h1>
            <h2
              ref={titreCodeRef}
              tabIndex={-1}
              className="m-0 font-semibold outline-none"
              style={{ fontSize: 18 }}
            >
              Saisissez le code reçu
            </h2>
          </div>

          {messageEnvoi && (
            <div className="mt-4">
              <Encadre icone={Info}>
                {messageEnvoi}
                {expireDans ? ` Le code est valable ${Math.round(expireDans / 60)} minutes.` : null}
              </Encadre>
            </div>
          )}
          <p className="mt-3 mb-0" style={{ fontSize: 14, color: TEXTE_SECONDAIRE }}>
            Numéro : <strong className="text-white">{phone.trim()}</strong>{" "}
            <button
              type="button"
              onClick={() => {
                setCode("");
                changerEtape("numero");
              }}
              className="min-h-11 px-1 font-semibold text-white underline underline-offset-2"
            >
              Modifier
            </button>
          </p>

          <div className="mt-4 flex flex-col gap-2">
            <SaisieCode
              valeur={code}
              onChange={setCode}
              legende="Code à 6 chiffres"
              invalide={Boolean(erreursChamps.code)}
              describedBy={decritPar(erreursChamps.code && "code-erreur")}
            />
            <ErreurChamp id="code-erreur" message={erreursChamps.code} />
          </div>

          <div className="mt-5 flex flex-col gap-4">
            <ChampMotDePasse
              id="nouveau-mdp"
              libelle="Nouveau mot de passe"
              icone={Lock}
              hauteur={54}
              autoComplete="new-password"
              enterKeyHint="next"
              required
              minLength={LONGUEUR_MIN}
              value={nouveau}
              onChange={(e) => setNouveau(e.target.value)}
              visible={afficherMdp}
              onBasculer={() => setAfficherMdp(!afficherMdp)}
              pluriel
              aide={`${LONGUEUR_MIN} caractères minimum.`}
              erreur={erreursChamps.nouveau_mot_de_passe}
            />
            <Champ
              id="confirmation-mdp"
              libelle="Confirmer le nouveau mot de passe"
              hauteur={54}
              type={afficherMdp ? "text" : "password"}
              autoComplete="new-password"
              enterKeyHint="done"
              required
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              erreur={erreursChamps.confirmation}
            />
          </div>

          <div className="mt-4">
            <MessageErreur message={erreur} />
          </div>

          <div className="flex-1 min-h-8" />

          <div className="flex flex-col gap-2">
            <BoutonPrincipal disabled={enCours || attenteConfirmation.restant > 0}>
              {enCours
                ? "Modification…"
                : attenteConfirmation.restant > 0
                  ? `Réessayer dans ${formaterAttente(attenteConfirmation.restant)}`
                  : "Changer le mot de passe"}
            </BoutonPrincipal>
            <button
              type="button"
              onClick={() => void demanderCode()}
              disabled={enCours || renvoi.restant > 0}
              className="h-11 font-semibold disabled:opacity-60"
              style={{ fontSize: 14, color: TEXTE_SECONDAIRE }}
            >
              {`Renvoyer un code${libelleRenvoi}`}
            </button>
            <LigneLien>
              <Link to="/login" className={CLASSE_LIEN}>
                Retour à la connexion
              </Link>
            </LigneLien>
          </div>
        </form>
      )}
    </EcranSombre>
  );
}
