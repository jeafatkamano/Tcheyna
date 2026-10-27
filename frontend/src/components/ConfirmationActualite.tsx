/**
 * ConfirmationActualite.tsx — « Votre annonce est-elle toujours d'actualité ? »
 *
 * Décision D6 (lot 2.3) : une annonce sans activité est retirée des
 * résultats, après une relance au propriétaire. Ce bloc, posé en haut de la
 * page de l'annonce dans l'espace propriétaire, lui permet de la confirmer
 * (PUT /listings/<id>/confirmer) sans toucher au formulaire.
 *
 * Arrivée depuis la relance (lien `?echeance=AAAA-MM-JJ`) : le bloc devient
 * un bandeau d'avertissement qui reprend l'échéance. La règle d'activité est
 * tenue par le serveur : la page n'affiche une date de retrait que s'il la
 * donne (réponse de la confirmation) ou si le lien de relance la porte.
 *
 * Toujours hors du <form> de l'annonce : confirmer ne doit jamais l'enregistrer.
 */
import { CalendarCheck, Hourglass } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router";

import { ApiError, listingsAPI, type Listing } from "../api";
import { formatDate } from "../lib/format";
import { MessageErreur, MessageSucces } from "./Etats";

const FORMAT_ECHEANCE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Échéance lue dans le lien de relance : date AAAA-MM-JJ stricte et réelle
 * (ni « 2026-02-30 », ni texte libre), sinon `null` et pas de bandeau.
 */
function lireEcheance(valeur: string | null): Date | null {
  const morceaux = valeur ? FORMAT_ECHEANCE.exec(valeur) : null;
  if (!morceaux) return null;
  const [annee, mois, jour] = morceaux.slice(1).map(Number);
  const date = new Date(annee, mois - 1, jour);
  const reelle =
    date.getFullYear() === annee && date.getMonth() === mois - 1 && date.getDate() === jour;
  return reelle ? date : null;
}

/** Échéance déjà passée (relance tardive, premier passage au déploiement). */
function estPassee(echeance: Date): boolean {
  const aujourdhui = new Date();
  aujourdhui.setHours(0, 0, 0, 0);
  return echeance < aujourdhui;
}

interface Etat {
  enCours: boolean;
  erreur: string | null;
  /** Date de retrait renvoyée par le serveur après confirmation. */
  expiration: string | null;
  /** Serveur antérieur au lot 2.3 (404, 405) : rien à confirmer. */
  indisponible: boolean;
}

export function ConfirmationActualite({
  listing,
  onPerimee,
  className,
}: {
  listing: Listing;
  /** L'annonce a changé d'état côté serveur (409) : la page la relit. */
  onPerimee: () => void;
  className?: string;
}) {
  const [parametres, setParametres] = useSearchParams();
  const [etat, setEtat] = useState<Etat>({
    enCours: false,
    erreur: null,
    expiration: null,
    indisponible: false,
  });

  const enLigne = listing.status === "active";
  const echeance = lireEcheance(parametres.get("echeance"));

  async function confirmer() {
    if (etat.enCours) return;
    setEtat((e) => ({ ...e, enCours: true, erreur: null }));
    try {
      const reponse = await listingsAPI.confirmer(listing.id);
      setEtat((e) => ({ ...e, enCours: false, expiration: reponse.expiration_prevue }));
      // Relance traitée : le bandeau ne revient pas au rechargement de la page.
      if (parametres.has("echeance")) {
        setParametres(
          (p) => {
            p.delete("echeance");
            return p;
          },
          { replace: true },
        );
      }
    } catch (err) {
      if (err instanceof ApiError && (err.statut === 404 || err.statut === 405)) {
        setEtat((e) => ({ ...e, enCours: false, indisponible: true }));
        return;
      }
      setEtat((e) => ({
        ...e,
        enCours: false,
        erreur: err instanceof ApiError ? err.message : "Une erreur est survenue",
      }));
      // Retirée ou conclue entre-temps : la page relit l'annonce, qui propose
      // alors ce qui convient (remise en ligne notamment).
      if (err instanceof ApiError && err.statut === 409) onPerimee();
    }
  }

  if (etat.expiration) {
    return (
      <div className={className}>
        <MessageSucces
          message={`Annonce confirmée. Sans autre activité, elle sera retirée le ${formatDate(etat.expiration)}.`}
        />
      </div>
    );
  }

  if (etat.indisponible) {
    return (
      <div className={className}>
        <p className="text-xs text-center" role="status" style={{ color: "#64748B" }}>
          La confirmation n'est pas encore disponible. Réessayez plus tard.
        </p>
      </div>
    );
  }

  if (!enLigne) {
    return etat.erreur ? (
      <div className={className}>
        <MessageErreur message={etat.erreur} />
      </div>
    ) : null;
  }

  const bandeau = echeance !== null;
  const bouton = (
    <button
      type="button"
      onClick={confirmer}
      disabled={etat.enCours}
      className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
      style={{ background: bandeau ? "#B45309" : "#F0F4FA", color: bandeau ? "white" : "#1E3A5F" }}
    >
      <CalendarCheck size={16} aria-hidden="true" />
      {etat.enCours ? "Confirmation…" : "Confirmer que l'annonce est toujours d'actualité"}
    </button>
  );

  return (
    <div className={className}>
      <section
        className="rounded-2xl p-4 space-y-3"
        role={bandeau ? "alert" : undefined}
        style={
          bandeau
            ? { background: "#FEF3C7", border: "1.5px solid #FDE68A" }
            : { background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }
        }
      >
        <div className="flex items-start gap-2">
          <Hourglass
            size={17}
            aria-hidden="true"
            style={{ color: bandeau ? "#92400E" : "#64748B", flexShrink: 0, marginTop: 1 }}
          />
          <p className="text-sm leading-relaxed" style={{ color: bandeau ? "#92400E" : "#475569" }}>
            {echeance === null
              ? "Une annonce sans activité finit par être retirée des résultats. Confirmez qu'elle est toujours d'actualité pour la garder en ligne."
              : estPassee(echeance)
                ? "Votre annonce sera bientôt retirée faute d'activité : confirmez qu'elle est toujours d'actualité."
                : `Votre annonce sera retirée le ${formatDate(echeance.toISOString())} faute d'activité : confirmez qu'elle est toujours d'actualité.`}
          </p>
        </div>
        <MessageErreur message={etat.erreur} />
        {bouton}
      </section>
    </div>
  );
}
