/**
 * RegisterPage.tsx — Inscription en deux étapes (maquettes Inscription1 et
 * Inscription2, lot 3.14).
 *
 *   1. rôle, nom, téléphone, e-mail ;
 *   2. mot de passe, ville, quartier, conditions.
 *
 * L'API ne change pas : un seul POST /auth/register à la fin, mêmes champs
 * qu'avant. Chaque étape valide ses champs avant de passer à la suivante.
 *
 * L'étape est portée par l'historique (`state.etapeInscription`) : passer à
 * l'étape 2 ajoute une entrée, si bien que la flèche de l'écran comme le
 * bouton retour d'Android reviennent à l'étape 1. Le composant reste monté :
 * la saisie est conservée.
 *
 * Après l'inscription : avec un numéro, l'écran « Vérifiez votre numéro »
 * (/inscription/verification), puis l'onboarding du rôle ; sans numéro,
 * l'onboarding directement. Dans l'onboarding (`onInscrit`), rien ne change :
 * il propose lui-même la vérification du numéro.
 */
import { ArrowRight, Building2, Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

import { ApiError, type Role } from "../api";
import { MessageErreur } from "../components/Etats";
import {
  BoutonPrincipal,
  BoutonRetour,
  Champ,
  ChampMotDePasse,
  CLASSE_LIEN,
  EcranSombre,
  ErreurChamp,
  Libelle,
  LigneLien,
  TEXTE_SECONDAIRE,
  TitreEcran,
} from "../components/FormulaireSombre";
import { useAuth } from "../context/AuthContext";
import { useGeo } from "../hooks/useGeo";
import { fixerDestinationApresInscription } from "../lib/apresInscription";

type RoleInscription = Exclude<Role, "admin">;

interface Props {
  /** Rôle imposé par le parcours d'onboarding (masque alors le sélecteur). */
  roleImpose?: RoleInscription;
  /** Appelé après une inscription réussie. Sans lui, on enchaîne sur la suite (voir plus haut). */
  onInscrit?: () => void;
}

/** Règle du serveur (`MotDePasse` : 8 caractères minimum). */
const LONGUEUR_MIN_MDP = 8;

type NomChamp = "full_name" | "email" | "phone" | "password" | "ville" | "quartier";
type ErreursChamps = Partial<Record<NomChamp, string>>;

const CHAMPS_ETAPE_1: readonly string[] = ["role", "full_name", "email", "phone"];

interface Formulaire {
  full_name: string;
  email: string;
  phone: string;
  password: string;
  pays: string;
  ville: string;
  quartier: string;
}

function validerEtape1(form: Formulaire): ErreursChamps {
  const erreurs: ErreursChamps = {};
  if (!form.full_name.trim()) erreurs.full_name = "Saisissez votre nom complet.";
  const email = form.email.trim();
  if (!email) erreurs.email = "Saisissez votre adresse e-mail.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) erreurs.email = "Adresse e-mail invalide.";
  return erreurs;
}

function validerEtape2(form: Formulaire): ErreursChamps {
  return form.password.length < LONGUEUR_MIN_MDP
    ? { password: `${LONGUEUR_MIN_MDP} caractères minimum.` }
    : {};
}

/**
 * Erreur du serveur : message général et messages par champ.
 *   - 422 : `details` = [{ champ, code, message }] (format commun du serveur) ;
 *   - 409 et 400 de /auth/register (backend/app/routes/auth.py) : e-mail ou
 *     numéro déjà utilisé, numéro invalide, sans `details` : rattachés au
 *     champ d'après le message.
 */
function analyserErreur(err: unknown): { general: string | null; champs: ErreursChamps } {
  if (!(err instanceof ApiError)) return { general: "Une erreur est survenue", champs: {} };
  const champs: ErreursChamps = {};
  const details = (err.details as { details?: unknown } | null)?.details;
  for (const detail of Array.isArray(details) ? details : []) {
    const { champ, message } = (detail ?? {}) as { champ?: unknown; message?: unknown };
    if (typeof champ === "string" && typeof message === "string") champs[champ as NomChamp] ??= message;
  }
  if (err.statut === 409 || err.statut === 400) {
    if (/e-mail/i.test(err.message)) champs.email ??= err.message;
    else if (/téléphone/i.test(err.message)) champs.phone ??= err.message;
  }
  return { general: err.message, champs };
}

export function RegisterPage({ roleImpose, onInscrit }: Props = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { inscrire } = useAuth();

  const roleInitial = roleImpose ?? (params.get("role") as RoleInscription) ?? "tenant";
  const [role, setRole] = useState<RoleInscription>(
    ["tenant", "landlord", "agency"].includes(roleInitial) ? roleInitial : "tenant",
  );
  const [conditionsAcceptees, setConditionsAcceptees] = useState(false);
  const [form, setForm] = useState<Formulaire>({
    full_name: "",
    email: "",
    phone: "",
    password: "",
    pays: "Guinée",
    ville: "Conakry",
    quartier: "",
  });
  const [erreurs, setErreurs] = useState<ErreursChamps>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const geo = useGeo(form.pays, form.ville);

  const etat = location.state as { etapeInscription?: number } | null;
  const etape = etat?.etapeInscription === 2 ? 2 : 1;

  // Le titre de l'étape reçoit le focus quand l'étape change (pas au chargement).
  const titreRef = useRef<HTMLDivElement>(null);
  const premierRendu = useRef(true);
  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false;
      return;
    }
    titreRef.current?.querySelector("h1")?.focus();
  }, [etape]);

  const maj = (champ: keyof Formulaire) => (valeur: string) => {
    setForm((f) => ({ ...f, [champ]: valeur }));
    setErreurs((e) => ({ ...e, [champ]: undefined }));
  };

  // Vrai si l'étape 2 a été ouverte depuis l'étape 1 de cette page : le
  // retour peut alors retirer son entrée de l'historique.
  const etape2Poussee = useRef(false);

  // La destination d'après inscription ne survit pas à la page.
  useEffect(() => () => fixerDestinationApresInscription(null), []);

  function allerEtape2() {
    etape2Poussee.current = true;
    navigate(`${location.pathname}${location.search}`, {
      state: { ...(etat ?? {}), etapeInscription: 2 },
    });
  }

  /**
   * Retour à l'étape 1. Étape 2 ouverte depuis l'étape 1 : on retire son
   * entrée de l'historique (comme le bouton retour d'Android). Étape 2
   * retrouvée après un rechargement, saisie perdue : on la remplace par
   * l'étape 1, sans quitter la page.
   */
  function revenirEtape1() {
    if (etape2Poussee.current) {
      etape2Poussee.current = false;
      navigate(-1);
      return;
    }
    const reste = { ...(etat ?? {}) };
    delete reste.etapeInscription;
    navigate(`${location.pathname}${location.search}`, { replace: true, state: reste });
  }

  function continuer(e: React.FormEvent) {
    e.preventDefault();
    const trouvees = validerEtape1(form);
    setErreurs(trouvees);
    setErreur(null);
    if (Object.keys(trouvees).length === 0) allerEtape2();
  }

  async function creer(e: React.FormEvent) {
    e.preventDefault();
    // Étape 2 ouverte sans étape 1 valide (page rechargée) : retour à l'étape 1.
    const etape1 = validerEtape1(form);
    if (Object.keys(etape1).length > 0) {
      setErreurs(etape1);
      revenirEtape1();
      return;
    }
    const trouvees = validerEtape2(form);
    setErreurs(trouvees);
    setErreur(null);
    if (Object.keys(trouvees).length > 0 || !conditionsAcceptees || enCours) return;

    // Après l'inscription : code SMS si un numéro est saisi, sinon l'onboarding.
    // Fixé avant l'appel : la garde de /inscription voit la session avant
    // que cette page ait navigué (lib/apresInscription.ts).
    const suite = role === "tenant" ? "/onboarding/tenant" : "/onboarding/owner";
    const destination = onInscrit
      ? null
      : form.phone.trim()
        ? { vers: "/inscription/verification", state: { suite } }
        : { vers: suite };
    fixerDestinationApresInscription(destination);

    setEnCours(true);
    try {
      await inscrire({
        ...form,
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        role,
        phone: form.phone.trim() || undefined,
        quartier: form.quartier || undefined,
      });
    } catch (err) {
      fixerDestinationApresInscription(null);
      const { general, champs } = analyserErreur(err);
      setErreurs(champs);
      setErreur(general);
      setEnCours(false);
      // Champ fautif à l'étape 1 : on y revient, saisie conservée.
      if (Object.keys(champs).some((c) => CHAMPS_ETAPE_1.includes(c))) revenirEtape1();
      return;
    }
    setEnCours(false);
    // Depuis l'onboarding, on enchaîne sur l'étape suivante du parcours.
    if (onInscrit) {
      onInscrit();
      return;
    }
    if (destination) navigate(destination.vers, { replace: true, state: destination.state });
  }

  const avecHistorique = location.key !== "default";
  const retourEtape1 = avecHistorique ? () => navigate(-1) : () => navigate("/");

  return (
    <EcranSombre>
      <form onSubmit={etape === 1 ? continuer : creer} className="flex-1 flex flex-col" noValidate>
        <div className="h-11 flex items-center gap-3">
          <BoutonRetour
            onClick={etape === 1 ? retourEtape1 : revenirEtape1}
            libelle={etape === 1 ? "Retour" : "Étape précédente"}
          />
          <div className="grow flex gap-1.5" role="img" aria-label={`Étape ${etape} sur 2`}>
            {[1, 2].map((n) => (
              <span
                key={n}
                className="grow h-1.5 rounded-full"
                style={{ background: n <= etape ? "#F97316" : "rgba(255,255,255,0.2)" }}
              />
            ))}
          </div>
          <span className="shrink-0 font-semibold" style={{ fontSize: 13, color: TEXTE_SECONDAIRE }} aria-hidden="true">
            {etape} / 2
          </span>
        </div>

        <div ref={titreRef} className="mt-5">
          {etape === 1 ? (
            <TitreEcran taille={28} sousTitre="Gratuit. Vous construirez votre niveau de confiance étape par étape.">
              Créer votre compte
            </TitreEcran>
          ) : (
            <TitreEcran taille={28} sousTitre="Dernière étape avant de découvrir les annonces.">
              Sécurisez votre compte
            </TitreEcran>
          )}
        </div>

        {etape === 1 ? (
          <Etape1
            form={form}
            maj={maj}
            erreurs={erreurs}
            role={role}
            setRole={setRole}
            roleImpose={roleImpose}
          />
        ) : (
          <Etape2
            form={form}
            maj={maj}
            setForm={setForm}
            erreurs={erreurs}
            villes={geo.villes}
            quartiers={geo.quartiers}
            conditionsAcceptees={conditionsAcceptees}
            setConditionsAcceptees={setConditionsAcceptees}
          />
        )}

        <div className="mt-5">
          <MessageErreur message={erreur} />
        </div>

        <div className="flex-1 min-h-8" />

        {etape === 1 ? (
          <div className="flex flex-col gap-2.5">
            <BoutonPrincipal>
              Continuer
              <ArrowRight size={18} strokeWidth={2.4} aria-hidden="true" />
            </BoutonPrincipal>
            <LigneLien>
              Déjà un compte ?{" "}
              <Link to="/login" className={CLASSE_LIEN}>
                Se connecter
              </Link>
            </LigneLien>
          </div>
        ) : (
          <BoutonPrincipal disabled={enCours || !conditionsAcceptees}>
            {enCours ? "Création du compte…" : "Créer mon compte"}
          </BoutonPrincipal>
        )}
      </form>
    </EcranSombre>
  );
}

// ─── Étape 1 : rôle, nom, téléphone, e-mail ──────────────────

const ROLES = [
  { valeur: "tenant" as const, icone: Search, label: "Je cherche", sous: "Locataire" },
  { valeur: "landlord" as const, icone: Building2, label: "Je loue", sous: "Propriétaire" },
];

function Etape1({
  form,
  maj,
  erreurs,
  role,
  setRole,
  roleImpose,
}: {
  form: Formulaire;
  maj: (champ: keyof Formulaire) => (valeur: string) => void;
  erreurs: ErreursChamps;
  role: RoleInscription;
  setRole: (role: RoleInscription) => void;
  roleImpose?: RoleInscription;
}) {
  return (
    <>
      {/* Choix du rôle — masqué quand le parcours l'impose déjà */}
      <div
        className="mt-4 grid grid-cols-2 gap-3"
        role="radiogroup"
        aria-label="Je suis"
        hidden={Boolean(roleImpose)}
      >
        {ROLES.map((option) => {
          const actif = role === option.valeur;
          return (
            <button
              key={option.valeur}
              type="button"
              role="radio"
              aria-checked={actif}
              onClick={() => setRole(option.valeur)}
              className="relative h-[92px] rounded-[18px] flex flex-col items-start justify-center gap-1 px-4 text-white text-left"
              style={{
                border: actif ? "2px solid #F97316" : "1.5px solid rgba(255,255,255,0.2)",
                background: actif ? "rgba(249,115,22,0.14)" : "rgba(255,255,255,0.05)",
              }}
            >
              <option.icone size={22} color={actif ? "#F97316" : "rgba(255,255,255,0.75)"} aria-hidden="true" />
              <span className="font-bold" style={{ fontSize: 15 }}>
                {option.label}
              </span>
              <span style={{ fontSize: 12, color: TEXTE_SECONDAIRE }}>{option.sous}</span>
              {actif && (
                <span
                  className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: "#F97316" }}
                  aria-hidden="true"
                >
                  <Check size={13} strokeWidth={3} color="#ffffff" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-3.5">
        <Champ
          id="nom"
          libelle="Nom complet"
          hauteur={54}
          autoComplete="name"
          autoCapitalize="words"
          enterKeyHint="next"
          value={form.full_name}
          onChange={(e) => maj("full_name")(e.target.value)}
          placeholder="Aminata Diallo"
          erreur={erreurs.full_name}
        />
        <Champ
          id="tel"
          libelle={
            <>
              Téléphone <span className="font-normal" style={{ color: "rgba(255,255,255,0.7)" }}>(recommandé)</span>
            </>
          }
          prefixe="+224"
          hauteur={54}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          enterKeyHint="next"
          value={form.phone}
          onChange={(e) => maj("phone")(e.target.value)}
          placeholder="622 52 92 52"
          aide="Vérifié par SMS : niveau 1, pour pouvoir candidater."
          erreur={erreurs.phone}
        />
        <Champ
          id="email"
          libelle="E-mail"
          hauteur={54}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          value={form.email}
          onChange={(e) => maj("email")(e.target.value)}
          placeholder="vous@exemple.com"
          erreur={erreurs.email}
        />
      </div>
    </>
  );
}

// ─── Étape 2 : mot de passe, ville, quartier, conditions ─────

function Selecteur({
  id,
  libelle,
  value,
  onChange,
  children,
}: {
  id: string;
  libelle: string;
  value: string;
  onChange: (valeur: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <Libelle htmlFor={id}>{libelle}</Libelle>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full h-[54px] rounded-2xl text-white outline-none appearance-none [&_option]:text-[#1E293B]"
          style={{
            padding: "0 36px 0 14px",
            background: "rgba(255,255,255,0.07)",
            border: "1.5px solid rgba(255,255,255,0.2)",
            fontSize: 15,
          }}
        >
          {children}
        </select>
        <ChevronDown
          size={18}
          className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
          color="rgba(255,255,255,0.7)"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

/** Barres de longueur du mot de passe : la troisième s'allume au minimum requis. */
function BarresLongueur({ longueur }: { longueur: number }) {
  const allumees = longueur === 0 ? 0 : longueur < LONGUEUR_MIN_MDP / 2 ? 1 : longueur < LONGUEUR_MIN_MDP ? 2 : 3;
  return (
    <div className="flex gap-1.5" aria-hidden="true">
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className="grow h-1 rounded-full"
          style={{ background: n <= allumees ? "#F97316" : "rgba(255,255,255,0.2)" }}
        />
      ))}
    </div>
  );
}

function Etape2({
  form,
  maj,
  setForm,
  erreurs,
  villes,
  quartiers,
  conditionsAcceptees,
  setConditionsAcceptees,
}: {
  form: Formulaire;
  maj: (champ: keyof Formulaire) => (valeur: string) => void;
  setForm: (f: (avant: Formulaire) => Formulaire) => void;
  erreurs: ErreursChamps;
  villes: string[];
  quartiers: string[];
  conditionsAcceptees: boolean;
  setConditionsAcceptees: (v: boolean) => void;
}) {
  // Les options du sélecteur arrivent de l'API : la valeur courante reste
  // proposée même avant leur arrivée.
  const listeVilles = villes.includes(form.ville) ? villes : [form.ville, ...villes];
  return (
    <div className="mt-[26px] flex flex-col gap-[18px]">
      <ChampMotDePasse
          id="mdp"
          libelle="Mot de passe"
          hauteur={54}
          autoComplete="new-password"
          enterKeyHint="done"
          value={form.password}
          onChange={(e) => maj("password")(e.target.value)}
          sousSaisie={<BarresLongueur longueur={form.password.length} />}
          aide={`${LONGUEUR_MIN_MDP} caractères minimum`}
          erreur={erreurs.password}
        />

      <div className="grid grid-cols-2 gap-3">
        <Selecteur
          id="ville"
          libelle="Ville"
          value={form.ville}
          onChange={(ville) => setForm((f) => ({ ...f, ville, quartier: "" }))}
        >
          {listeVilles.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Selecteur>
        <Selecteur id="quartier" libelle="Quartier" value={form.quartier} onChange={maj("quartier")}>
          <option value="">À préciser</option>
          {quartiers.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </Selecteur>
      </div>
      <ErreurChamp id="ville-erreur" message={erreurs.ville ?? erreurs.quartier} />

      {/* Consentement explicite : la plateforme collecte des pièces
          d'identité, on ne peut pas le faire par acceptation tacite. */}
      <label
        className="flex gap-3 items-start rounded-2xl cursor-pointer"
        style={{ padding: 14, background: "rgba(255,255,255,0.05)" }}
      >
        <input
          type="checkbox"
          checked={conditionsAcceptees}
          onChange={(e) => setConditionsAcceptees(e.target.checked)}
          className="w-[22px] h-[22px] m-0 shrink-0 accent-orange-500"
        />
        <span style={{ fontSize: 14, lineHeight: 1.5, color: "rgba(255,255,255,0.85)" }}>
          J'accepte les{" "}
          <Link to="/legal/cgu" target="_blank" className="font-bold text-white underline underline-offset-2">
            conditions générales
          </Link>{" "}
          et la{" "}
          <Link
            to="/legal/confidentialite"
            target="_blank"
            className="font-bold text-white underline underline-offset-2"
          >
            politique de confidentialité
          </Link>
          , notamment le traitement des pièces que je téléverserai pour vérifier mon dossier.
        </span>
      </label>
    </div>
  );
}
