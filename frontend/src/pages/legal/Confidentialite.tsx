/**
 * Confidentialite.tsx — Politique de protection des données.
 *
 * Décrit les données réellement traitées par l'application, y compris les
 * pièces d'identité : c'est la condition préalable à leur collecte.
 */
import { ACompleter, Liste, PageLegale, Section } from "./PageLegale";

export function Confidentialite() {
  return (
    <PageLegale
      titre="Politique de confidentialité"
      sousTitre="Quelles données nous traitons, pourquoi, et pendant combien de temps"
    >
      <Section titre="1. Responsable du traitement">
        <p>
          Le responsable du traitement est <ACompleter quoi="dénomination sociale de l'éditeur" />,
          éditeur de la plateforme Tcheyna. Pour toute question relative à vos données :{" "}
          <ACompleter quoi="adresse e-mail dédiée aux données personnelles" />.
        </p>
      </Section>

      <Section titre="2. Données collectées">
        <p>
          <strong>À la création du compte</strong> : nom complet, adresse e-mail, mot de passe
          (conservé sous forme chiffrée et jamais lisible par nos équipes), numéro de
          téléphone, pays, ville et quartier, rôle choisi (locataire, propriétaire ou agence).
        </p>
        <p>
          <strong>Photo de profil</strong>, lorsque vous en déposez une.
        </p>
        <p>
          <strong>Dans le Passeport Locataire</strong> : situation professionnelle, employeur,
          revenu mensuel déclaré, existence et identité d'un garant, ainsi que les pièces que
          vous téléversez — carte nationale d'identité (recto et verso), passeport,
          justificatif de revenus.
        </p>
        <p>
          <strong>Pour les propriétaires et agences</strong> : contenu des annonces, photos des
          biens, et pièces administratives déposées en vue de la certification (titre foncier,
          bail, acte notarié, quittance).
        </p>
        <p>
          <strong>À l'usage</strong> : candidatures déposées, messages échangés avec l'autre
          partie, avis publiés, favoris, historique des paiements (montant, date, référence,
          moyen de paiement choisi), notifications.
        </p>
        <p>
          Nous ne collectons ni vos codes Mobile Money, ni vos identifiants bancaires : la
          saisie s'effectue chez l'opérateur de paiement.
        </p>
      </Section>

      <Section titre="3. Finalités et bases de la collecte">
        <Liste
          items={[
            "Créer et gérer votre compte, et vous authentifier — nécessaire à l'exécution du service que vous demandez.",
            "Mettre en relation locataires et propriétaires, et calculer la compatibilité entre une recherche et une annonce.",
            "Vérifier les pièces d'identité et de revenus afin d'attribuer un niveau de confiance — sur la base de votre consentement explicite, que vous pouvez retirer.",
            "Vérifier les pièces de propriété en vue de la certification d'une annonce.",
            "Traiter les paiements et émettre les reçus — nécessaire à l'exécution des services payants et au respect de nos obligations comptables.",
            "Prévenir la fraude, les faux profils et les fausses annonces — intérêt légitime de la plateforme et de ses utilisateurs.",
          ]}
        />
      </Section>

      <Section titre="4. Qui voit quoi">
        <p>
          <strong>Vos pièces d'identité et justificatifs de revenus ne sont jamais publics.</strong>{" "}
          Ils sont conservés dans un espace de stockage privé et ne sont consultables que par
          les vérificateurs habilités de Tcheyna, au moyen de liens temporaires expirant après
          quelques minutes.
        </p>
        <p>
          Un propriétaire consultant votre candidature voit votre nom, votre photo de profil,
          votre niveau de confiance, votre ville et quartier, votre situation professionnelle
          et votre revenu déclaré, ainsi que les avis vous concernant. Il ne voit ni vos
          documents, ni votre adresse e-mail, ni votre numéro de téléphone tant que vous ne
          les lui communiquez pas.
        </p>
        <p>
          Sont publics : votre nom, votre photo de profil, votre badge de niveau, et les avis
          publiés à votre sujet.
        </p>
      </Section>

      <Section titre="5. Destinataires et sous-traitants">
        <Liste
          items={[
            "Notre hébergeur applicatif et notre fournisseur de base de données et de stockage de fichiers, situés dans l'Union européenne.",
            "Notre prestataire de paiement Mobile Money, pour les seules données nécessaires à une transaction (nom, contact, montant).",
            "Notre prestataire d'envoi de SMS, pour l'envoi des codes de vérification.",
            "Les autorités administratives ou judiciaires, sur demande légalement fondée.",
          ]}
        />
        <p>
          Nous ne vendons pas vos données et ne les transmettons à aucun annonceur.
        </p>
      </Section>

      <Section titre="6. Transfert hors de Guinée">
        <p>
          Nos serveurs et notre stockage de fichiers sont situés dans l'Union européenne. Vos
          données, y compris les pièces d'identité, sont donc hébergées hors du territoire
          guinéen, dans un cadre offrant un niveau de protection reconnu. En utilisant la
          plateforme, vous êtes informé de ce transfert.
        </p>
      </Section>

      <Section titre="7. Durées de conservation">
        <Liste
          items={[
            "Compte actif : les données sont conservées tant que le compte existe.",
            "Après fermeture du compte : suppression sous 30 jours, à l'exception des éléments ci-dessous.",
            "Pièces d'identité et justificatifs de revenus : supprimés dès qu'une décision de vérification est rendue, ou au plus tard 12 mois après leur dépôt.",
            "Paiements et reçus : conservés 10 ans, en raison des obligations comptables.",
            "Messages liés à une location conclue : conservés 3 ans, comme éléments de preuve en cas de litige.",
            "Avis publiés : conservés sous forme anonymisée après fermeture du compte de leur auteur.",
          ]}
        />
      </Section>

      <Section titre="8. Sécurité">
        <p>
          Les mots de passe sont stockés sous forme de condensats non réversibles. Les
          échanges avec la plateforme sont chiffrés en transit. Les documents confidentiels
          sont isolés dans un espace de stockage non public, distinct des photos d'annonces, et
          ne sont servis que par liens temporaires. L'accès aux pièces est réservé aux
          comptes de vérification.
        </p>
        <p>
          Aucun système n'est infaillible. En cas de violation de données susceptible de vous
          exposer à un risque, nous vous en informerons ainsi que l'autorité compétente.
        </p>
      </Section>

      <Section titre="9. Vos droits">
        <p>Vous pouvez à tout moment :</p>
        <Liste
          items={[
            "Accéder aux données que nous détenons sur vous et en obtenir une copie.",
            "Corriger une information inexacte, directement depuis votre profil ou sur demande.",
            "Demander la suppression de votre compte et de vos données, sous réserve des durées légales de conservation.",
            "Retirer votre consentement à la vérification d'identité — votre niveau de confiance repasse alors au niveau correspondant aux seules pièces restantes.",
            "Vous opposer à un traitement fondé sur notre intérêt légitime.",
          ]}
        />
        <p>
          Pour exercer ces droits, écrivez à{" "}
          <ACompleter quoi="adresse e-mail dédiée aux données personnelles" />. Nous répondons
          sous 30 jours. Vous pouvez également saisir{" "}
          <ACompleter quoi="autorité guinéenne de protection des données compétente" />.
        </p>
      </Section>

      <Section titre="10. Cookies et traceurs">
        <p>
          La plateforme ne dépose pas de cookie publicitaire et n'utilise pas de traceur
          tiers à des fins de mesure d'audience. Un jeton de connexion est conservé dans votre
          navigateur pour vous maintenir authentifié ; il disparaît à la déconnexion.
        </p>
      </Section>

      <Section titre="11. Mineurs">
        <p>
          La plateforme n'est pas destinée aux personnes de moins de 18 ans. Nous ne collectons
          pas sciemment leurs données ; si une telle collecte nous est signalée, le compte est
          supprimé.
        </p>
      </Section>

      <Section titre="12. Évolution de cette politique">
        <p>
          Toute modification substantielle vous sera signalée dans l'application avant son
          entrée en vigueur.
        </p>
      </Section>
    </PageLegale>
  );
}
