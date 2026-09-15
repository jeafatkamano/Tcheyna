/**
 * MentionsLegales.tsx — Identification de l'éditeur et de l'hébergeur.
 *
 * Les éléments d'identité juridique ne peuvent pas être devinés : ils sont
 * signalés comme à compléter plutôt que remplis par des valeurs plausibles.
 */
import { ACompleter, PageLegale, Section } from "./PageLegale";

export function MentionsLegales() {
  return (
    <PageLegale titre="Mentions légales" sousTitre="Qui édite et qui héberge cette plateforme">
      <div
        className="rounded-xl p-4 text-sm leading-relaxed"
        style={{ background: "#FEF3C7", border: "1px solid #FDE68A", color: "#92400E" }}
      >
        Les champs signalés ci-dessous doivent être renseignés par l'éditeur avant toute
        exploitation commerciale de la plateforme.
      </div>

      <Section titre="Éditeur">
        <p>
          <strong>Dénomination :</strong> <ACompleter quoi="dénomination sociale" />
        </p>
        <p>
          <strong>Forme juridique :</strong> <ACompleter quoi="forme juridique, ex. SARL" />
        </p>
        <p>
          <strong>Immatriculation :</strong>{" "}
          <ACompleter quoi="numéro RCCM et numéro d'identification fiscale" />
        </p>
        <p>
          <strong>Siège social :</strong> <ACompleter quoi="adresse complète à Conakry" />
        </p>
        <p>
          <strong>Directeur de la publication :</strong>{" "}
          <ACompleter quoi="nom du représentant légal" />
        </p>
        <p>
          <strong>Contact :</strong> <ACompleter quoi="adresse e-mail et téléphone" />
        </p>
      </Section>

      <Section titre="Hébergement">
        <p>
          <strong>Application et interface :</strong> Render Services, Inc., 525 Brannan
          Street, San Francisco, CA 94107, États-Unis — render.com
        </p>
        <p>
          <strong>Base de données et stockage des fichiers :</strong> Supabase, Inc. —
          supabase.com. Les données sont hébergées dans la région Union européenne (Irlande).
        </p>
      </Section>

      <Section titre="Nature du service">
        <p>
          Tcheyna est une plateforme de mise en relation entre locataires et propriétaires ou
          agences. Elle n'exerce pas l'activité d'agent immobilier, n'est pas mandataire des
          parties et n'intervient pas comme partie aux baux conclus par son intermédiaire.
        </p>
      </Section>

      <Section titre="Propriété intellectuelle">
        <p>
          La marque, le nom Tcheyna, l'identité visuelle, la structure du site et son contenu
          éditorial sont protégés. Toute reproduction ou représentation, totale ou partielle,
          sans autorisation préalable est interdite.
        </p>
        <p>
          Les photographies et textes des annonces demeurent la propriété de leurs auteurs, qui
          concèdent à Tcheyna le droit de les afficher sur la plateforme pour les besoins du
          service.
        </p>
      </Section>

      <Section titre="Signalement d'un contenu">
        <p>
          Une annonce frauduleuse, un profil suspect ou un contenu illicite peuvent être
          signalés à <ACompleter quoi="adresse e-mail de signalement" />. Chaque signalement
          est examiné et peut donner lieu au retrait du contenu et à la suspension du compte
          concerné.
        </p>
      </Section>

      <Section titre="Données personnelles">
        <p>
          Le traitement des données personnelles est décrit dans la politique de
          confidentialité, accessible depuis le pied de page de chaque écran.
        </p>
      </Section>
    </PageLegale>
  );
}
