/**
 * MotDePasseOubliePage.tsx — Mot de passe oublié, par SMS (lot 3.8).
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
import { ArrowLeft, Eye, EyeOff, KeyRound, Lock, Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

import { ApiError, authAPI, tokens } from "../api";
import { MessageErreur } from "../components/Etats";
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

const STYLE_CHAMP = { background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" };
const STYLE_CHAMP_INVALIDE = { ...STYLE_CHAMP, border: "1.5px solid #F87171" };

function ErreurChamp({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs mt-1.5 font-medium" style={{ color: "#FCA5A5" }}>
      {message}
    </p>
  );
}

/** Identifiants des textes qui décrivent un champ (aide, erreur). */
function decritPar(...ids: (string | false | undefined)[]) {
  return ids.filter(Boolean).join(" ") || undefined;
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
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "linear-gradient(160deg, #0F2040 0%, #1E3A5F 60%, #0F2040 100%)" }}
    >
      <header className="flex items-center justify-between px-6 pt-8 pb-4">
        <Link
          to="/login"
          className="p-2 -ml-2 rounded-lg text-white/70 hover:text-white"
          aria-label="Retour à la connexion"
        >
          <ArrowLeft size={20} />
        </Link>
        <span className="text-white font-bold tracking-tight" style={{ fontSize: "22px" }}>
          tcheyna
        </span>
        <span className="w-9" />
      </header>

      <div className="flex-1 flex flex-col justify-center px-6 pb-10">
        <div className="w-full max-w-sm mx-auto">
          <h1 className="text-white font-bold mb-2" style={{ fontSize: "28px", lineHeight: 1.2 }}>
            Mot de passe oublié
          </h1>

          <p className="sr-only" aria-live="polite">
            {annonceRenvoi}
          </p>

          {etape === "numero" ? (
            <form onSubmit={demanderCode} className="space-y-4" noValidate>
              <p className="text-white/60" style={{ fontSize: "15px" }}>
                Recevez par SMS un code pour choisir un nouveau mot de passe.
              </p>
              <p
                className="text-sm px-3.5 py-3 rounded-xl text-white/80"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                Seul un numéro <strong>vérifié</strong> permet de récupérer votre compte. Une
                fois connecté, pensez à vérifier votre numéro depuis votre profil.
              </p>

              <div>
                <label htmlFor="phone" className="block text-sm font-semibold text-white/80 mb-1.5">
                  Numéro de téléphone
                </label>
                <div className="relative">
                  <Phone
                    size={17}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2"
                    style={{ color: "#94A3B8" }}
                    aria-hidden="true"
                  />
                  <input
                    ref={champNumeroRef}
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="622 52 92 52"
                    aria-invalid={erreursChamps.phone ? true : undefined}
                    aria-describedby={decritPar("phone-aide", erreursChamps.phone && "phone-erreur")}
                    className="w-full pl-10 pr-4 py-3.5 rounded-xl outline-none"
                    style={erreursChamps.phone ? STYLE_CHAMP_INVALIDE : STYLE_CHAMP}
                  />
                </div>
                <p id="phone-aide" className="text-xs text-white/50 mt-1.5">
                  Indicatif +224 ajouté automatiquement pour la Guinée.
                </p>
                <ErreurChamp id="phone-erreur" message={erreursChamps.phone} />
              </div>

              <MessageErreur message={erreur} />

              <button
                type="submit"
                disabled={enCours || renvoi.restant > 0}
                className="w-full py-4 rounded-2xl font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-60"
                style={{ background: "#F97316", fontSize: "16px" }}
              >
                {enCours ? "Envoi…" : `Recevoir un code par SMS${libelleRenvoi}`}
              </button>
            </form>
          ) : (
            <form onSubmit={confirmer} className="space-y-4" noValidate>
              <h2
                ref={titreCodeRef}
                tabIndex={-1}
                className="text-white font-semibold outline-none"
                style={{ fontSize: "18px" }}
              >
                Saisissez le code reçu
              </h2>
              {messageEnvoi && (
                <div className="px-3.5 py-3 rounded-xl" style={{ background: "#EFF6FF" }}>
                  <p className="text-sm" style={{ color: "#1E3A5F" }}>
                    {messageEnvoi}
                  </p>
                  {expireDans ? (
                    <p className="text-xs mt-1.5" style={{ color: "#1D4ED8" }}>
                      Le code est valable {Math.round(expireDans / 60)} minutes.
                    </p>
                  ) : null}
                </div>
              )}
              <p className="text-sm text-white/60">
                Numéro : <strong className="text-white">{phone.trim()}</strong>{" "}
                <button
                  type="button"
                  onClick={() => {
                    setCode("");
                    changerEtape("numero");
                  }}
                  className="underline text-white/80"
                >
                  Modifier
                </button>
              </p>

              <div>
                <label htmlFor="code" className="block text-sm font-semibold text-white/80 mb-1.5">
                  Code à 6 chiffres
                </label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  aria-invalid={erreursChamps.code ? true : undefined}
                  aria-describedby={decritPar(erreursChamps.code && "code-erreur")}
                  className="w-full px-4 py-3.5 rounded-xl outline-none text-center font-bold"
                  style={{
                    ...(erreursChamps.code ? STYLE_CHAMP_INVALIDE : STYLE_CHAMP),
                    fontSize: "22px",
                    letterSpacing: "0.4em",
                  }}
                />
                <ErreurChamp id="code-erreur" message={erreursChamps.code} />
              </div>

              <div>
                <label htmlFor="nouveau-mdp" className="block text-sm font-semibold text-white/80 mb-1.5">
                  Nouveau mot de passe
                </label>
                <div className="relative">
                  <Lock
                    size={17}
                    className="absolute left-3.5 top-1/2 -translate-y-1/2"
                    style={{ color: "#94A3B8" }}
                    aria-hidden="true"
                  />
                  <input
                    id="nouveau-mdp"
                    type={afficherMdp ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={LONGUEUR_MIN}
                    value={nouveau}
                    onChange={(e) => setNouveau(e.target.value)}
                    aria-invalid={erreursChamps.nouveau_mot_de_passe ? true : undefined}
                    aria-describedby={decritPar(
                      "nouveau-mdp-aide",
                      erreursChamps.nouveau_mot_de_passe && "nouveau-mdp-erreur",
                    )}
                    className="w-full pl-10 pr-11 py-3.5 rounded-xl outline-none"
                    style={erreursChamps.nouveau_mot_de_passe ? STYLE_CHAMP_INVALIDE : STYLE_CHAMP}
                  />
                  <button
                    type="button"
                    onClick={() => setAfficherMdp(!afficherMdp)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2"
                    style={{ color: "#94A3B8" }}
                    aria-label={afficherMdp ? "Masquer les mots de passe" : "Afficher les mots de passe"}
                  >
                    {afficherMdp ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                <p id="nouveau-mdp-aide" className="text-xs text-white/50 mt-1.5">
                  {LONGUEUR_MIN} caractères minimum.
                </p>
                <ErreurChamp id="nouveau-mdp-erreur" message={erreursChamps.nouveau_mot_de_passe} />
              </div>

              <div>
                <label htmlFor="confirmation-mdp" className="block text-sm font-semibold text-white/80 mb-1.5">
                  Confirmer le nouveau mot de passe
                </label>
                <input
                  id="confirmation-mdp"
                  type={afficherMdp ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  aria-invalid={erreursChamps.confirmation ? true : undefined}
                  aria-describedby={decritPar(erreursChamps.confirmation && "confirmation-mdp-erreur")}
                  className="w-full px-4 py-3.5 rounded-xl outline-none"
                  style={erreursChamps.confirmation ? STYLE_CHAMP_INVALIDE : STYLE_CHAMP}
                />
                <ErreurChamp id="confirmation-mdp-erreur" message={erreursChamps.confirmation} />
              </div>

              <MessageErreur message={erreur} />

              <button
                type="submit"
                disabled={enCours || attenteConfirmation.restant > 0}
                className="w-full py-4 rounded-2xl font-semibold text-white flex items-center justify-center gap-2 transition-transform active:scale-[0.98] disabled:opacity-60"
                style={{ background: "#F97316", fontSize: "16px" }}
              >
                <KeyRound size={18} aria-hidden="true" />
                {enCours
                  ? "Modification…"
                  : attenteConfirmation.restant > 0
                    ? `Réessayer dans ${formaterAttente(attenteConfirmation.restant)}`
                    : "Changer le mot de passe"}
              </button>

              <button
                type="button"
                onClick={() => void demanderCode()}
                disabled={enCours || renvoi.restant > 0}
                className="w-full py-2 text-sm font-medium text-white/70 disabled:opacity-50"
              >
                {`Renvoyer un code${libelleRenvoi}`}
              </button>
            </form>
          )}

          <p className="text-center text-white/50 text-sm mt-6">
            <Link to="/login" className="font-semibold" style={{ color: "#F97316" }}>
              Retour à la connexion
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
