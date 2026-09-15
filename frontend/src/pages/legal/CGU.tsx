/**
 * CGU.tsx — Conditions générales d'utilisation.
 *
 * Ce texte décrit ce que la plateforme fait réellement aujourd'hui : rôle
 * d'intermédiaire, portée exacte de la vérification, tarifs effectivement
 * appliqués. Il ne promet rien que le produit ne tienne pas.
 */
import { ACompleter, Liste, PageLegale, Section } from "./PageLegale";

export function CGU() {
  return (
    <PageLegale
      titre="Conditions générales d'utilisation"
      sousTitre="Les règles d'usage de la plateforme Tcheyna"
    >
      <Section titre="1. Objet">
        <p>
          Tcheyna est une plateforme de mise en relation entre des personnes cherchant un
          logement en location et des propriétaires ou agences proposant des biens, en
          République de Guinée. Les présentes conditions régissent l'accès et l'usage du site
          et de ses services.
        </p>
        <p>
          Créer un compte ou utiliser la plateforme vaut acceptation de ces conditions.
        </p>
      </Section>

      <Section titre="2. Rôle de Tcheyna">
        <p>
          Tcheyna est un <strong>intermédiaire technique</strong>. La plateforme n'est ni
          propriétaire, ni bailleur, ni agent immobilier, ni mandataire des parties. Elle
          n'est pas partie au contrat de bail conclu entre un locataire et un propriétaire.
        </p>
        <p>
          En conséquence, Tcheyna ne garantit ni la conclusion d'une location, ni l'exécution
          du bail, ni la restitution de la caution, ni la conformité du logement à sa
          description.
        </p>
      </Section>

      <Section titre="3. Compte utilisateur">
        <Liste
          items={[
            "L'inscription est réservée aux personnes majeures et capables juridiquement.",
            "Les informations fournies doivent être exactes et tenues à jour.",
            "Chaque personne ne peut détenir qu'un seul compte. Les identifiants sont personnels et confidentiels.",
            "Vous êtes responsable de toute activité effectuée depuis votre compte.",
          ]}
        />
      </Section>

      <Section titre="4. Passeport Locataire et niveaux de confiance">
        <p>
          Le Passeport Locataire matérialise un niveau de confiance de 1 à 4, accordé
          uniquement sur pièces vérifiées :
        </p>
        <Liste
          items={[
            <>
              <strong>Niveau 1 — Basique</strong> : numéro de téléphone vérifié par code SMS.
            </>,
            <>
              <strong>Niveau 2 — Identifié</strong> : pièce d'identité contrôlée par un
              vérificateur Tcheyna.
            </>,
            <>
              <strong>Niveau 3 — Solvable</strong> : justificatif de revenus contrôlé.
            </>,
            <>
              <strong>Niveau 4 — Recommandé</strong> : au moins trois avis positifs de
              propriétaires après des locations conclues via la plateforme.
            </>,
          ]}
        />
        <p>
          La vérification porte sur la <strong>cohérence apparente et la lisibilité</strong>{" "}
          des documents transmis. Elle ne constitue pas une authentification auprès des
          autorités émettrices, ni une garantie de solvabilité future, ni une caution
          financière. Un niveau de confiance ne s'achète pas : aucun paiement ne permet de
          l'obtenir ou de l'augmenter.
        </p>
      </Section>

      <Section titre="5. Annonces et certification">
        <p>
          Le propriétaire est seul responsable du contenu de son annonce et garantit disposer
          du droit de mettre le bien en location.
        </p>
        <p>
          La mention « Annonce Certifiée » signifie qu'un vérificateur a examiné des pièces de
          propriété ou de gestion fournies par l'annonceur et les a jugées cohérentes avec
          l'annonce. Elle ne vaut pas expertise juridique du titre, ni garantie de l'absence
          de litige sur le bien.
        </p>
        <p>
          Sont interdites les annonces portant sur un bien inexistant, indisponible, ou dont
          l'annonceur n'a pas la maîtrise, ainsi que toute annonce trompeuse sur le prix, la
          localisation ou l'état du logement.
        </p>
      </Section>

      <Section titre="6. Services payants et tarifs">
        <p>Les services payants sont facturés en francs guinéens (GNF) :</p>
        <Liste
          items={[
            "Certification d'une annonce : 250 000 GNF, à la charge du propriétaire.",
            "Mise en avant d'une annonce pendant 30 jours : 200 000 GNF, à la charge du propriétaire.",
            "Abonnement Passeport Locataire, valable un an : 150 000 GNF, à la charge du locataire.",
            "Commission de mise en relation : 6 % du premier loyer, due par le propriétaire uniquement lorsqu'une location est effectivement conclue via la plateforme.",
          ]}
        />
        <p>
          La caution et le premier loyer peuvent être réglés par Mobile Money via la
          plateforme. Ces sommes sont dues au propriétaire : Tcheyna en assure l'acheminement
          et la traçabilité, sans en être bénéficiaire.
        </p>
        <p>
          Les frais de certification et de mise en avant correspondent à un service rendu dès
          leur paiement ; ils ne sont pas remboursables, y compris si la certification est
          refusée à l'issue de l'examen. Un refus de certification donne lieu à l'indication
          du motif et à la possibilité de soumettre un dossier corrigé.
        </p>
      </Section>

      <Section titre="7. Paiements">
        <p>
          Les paiements sont opérés par un prestataire de paiement Mobile Money agréé. Tcheyna
          ne collecte ni ne conserve les codes ou identifiants de paiement. Chaque paiement
          donne lieu à un reçu numérique, consultable par le payeur et par l'autre partie de
          l'opération concernée.
        </p>
      </Section>

      <Section titre="8. Comportements interdits">
        <Liste
          items={[
            "Transmettre des documents falsifiés ou appartenant à autrui.",
            "Demander ou exiger un paiement hors plateforme dans le but d'échapper à la commission due.",
            "Solliciter un versement avant toute visite ou tout accord, ou solliciter des frais de dossier non prévus par les présentes.",
            "Publier des propos injurieux, diffamatoires, ou des avis mensongers.",
            "Refuser un candidat sur un motif discriminatoire prohibé par la loi.",
            "Extraire automatiquement les données de la plateforme ou en perturber le fonctionnement.",
          ]}
        />
        <p>
          Tout manquement peut entraîner la suspension ou la suppression du compte, sans
          préjudice des suites judiciaires.
        </p>
      </Section>

      <Section titre="9. Avis">
        <p>
          Un avis ne peut être déposé qu'à l'issue d'une location conclue via la plateforme,
          par une partie à cette location. Les avis engagent leur auteur. Tcheyna peut retirer
          un avis manifestement injurieux, hors sujet ou mensonger.
        </p>
      </Section>

      <Section titre="10. Responsabilité">
        <p>
          Tcheyna met en œuvre les moyens raisonnables pour assurer la disponibilité du
          service, sans garantie d'un fonctionnement ininterrompu ou exempt d'erreur.
        </p>
        <p>
          La responsabilité de Tcheyna ne saurait être engagée à raison des différends entre
          utilisateurs, de l'inexécution d'un bail, ni des conséquences d'informations
          inexactes fournies par un utilisateur. Lorsqu'elle est engagée à raison d'un service
          payant, elle est limitée au montant effectivement versé pour ce service.
        </p>
      </Section>

      <Section titre="11. Résiliation">
        <p>
          Vous pouvez fermer votre compte à tout moment depuis votre profil ou en écrivant à
          l'adresse de contact. Les abonnements en cours ne sont pas remboursés au prorata.
          Tcheyna peut suspendre un compte en cas de manquement aux présentes, après
          information de l'utilisateur sauf urgence ou fraude manifeste.
        </p>
      </Section>

      <Section titre="12. Modification des conditions">
        <p>
          Ces conditions peuvent être modifiées. Toute modification substantielle est portée à
          la connaissance des utilisateurs, qui peuvent fermer leur compte s'ils la refusent.
        </p>
      </Section>

      <Section titre="13. Droit applicable et différends">
        <p>
          Les présentes conditions sont soumises au droit de la République de Guinée. À défaut
          de résolution amiable, tout différend relève des juridictions compétentes de{" "}
          <ACompleter quoi="juridiction compétente, ex. Conakry" />.
        </p>
      </Section>

      <Section titre="14. Contact">
        <p>
          Pour toute question relative aux présentes conditions :{" "}
          <ACompleter quoi="adresse e-mail de contact" />.
        </p>
      </Section>
    </PageLegale>
  );
}
