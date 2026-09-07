import { Heart } from "lucide-react";

import { favorisAPI, type Listing } from "../../api";
import { Erreur, ListeVide, SqueletteCartes } from "../../components/Etats";
import { ListingCard } from "../../components/ListingCard";
import { useApi } from "../../hooks/useApi";

export function FavorisPage() {
  const favoris = useApi(() => favorisAPI.liste(), []);

  async function retirer(listing: Listing) {
    // Retrait immédiat de la liste : c'est l'effet attendu sur cette page.
    favoris.muter((p) => ({
      ...p,
      listings: p.listings.filter((l) => l.id !== listing.id),
      total: p.total - 1,
    }));
    try {
      await favorisAPI.retirer(listing.id);
    } catch {
      void favoris.recharger();
    }
  }

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-5" style={{ background: "#1E3A5F" }}>
        <h1 className="text-white font-bold mb-1" style={{ fontSize: "20px" }}>
          Mes favoris
        </h1>
        <p className="text-white/60 text-sm">
          {favoris.data ? `${favoris.data.total} annonce${favoris.data.total > 1 ? "s" : ""} sauvegardée${favoris.data.total > 1 ? "s" : ""}` : "Vos annonces sauvegardées"}
        </p>
      </div>

      <div className="px-4 pt-5 space-y-4">
        {favoris.chargement ? (
          <SqueletteCartes nombre={2} />
        ) : favoris.erreur ? (
          <Erreur message={favoris.erreur} onReessayer={favoris.recharger} />
        ) : !favoris.data?.listings.length ? (
          <ListeVide
            titre="Aucun favori"
            description="Touchez le cœur sur une annonce pour la retrouver ici."
            icone={<Heart size={26} style={{ color: "#94A3B8" }} />}
            action={{ label: "Parcourir les annonces", to: "/tenant/listings" }}
          />
        ) : (
          favoris.data.listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} onToggleFavori={retirer} />
          ))
        )}
      </div>
    </div>
  );
}
