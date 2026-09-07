import { Search, SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";

import { favorisAPI, listingsAPI, type FiltresAnnonces, type Listing } from "../../api";
import { Erreur, ListeVide, SqueletteCartes } from "../../components/Etats";
import { ListingCard } from "../../components/ListingCard";
import { useApi } from "../../hooks/useApi";
import { useGeo } from "../../hooks/useGeo";
import { formatMontantCourt } from "../../lib/format";

const TRIS = [
  { valeur: "match", label: "Meilleur match" },
  { valeur: "recent", label: "Plus récentes" },
  { valeur: "prix_asc", label: "Prix croissant" },
  { valeur: "prix_desc", label: "Prix décroissant" },
  { valeur: "surface", label: "Plus grand" },
] as const;

const EQUIPEMENTS = [
  { cle: "has_generator", label: "Groupe électrogène" },
  { cle: "has_water", label: "Eau courante" },
  { cle: "is_secured", label: "Gardien / clôture" },
  { cle: "has_wifi", label: "WiFi" },
  { cle: "has_parking", label: "Parking" },
  { cle: "has_ac", label: "Climatisation" },
] as const;

const BUDGET_MAX = 10_000_000;

export function ListingsPage() {
  const geo = useGeo("Guinée", "Conakry");

  const [recherche, setRecherche] = useState("");
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const [filtres, setFiltres] = useState<FiltresAnnonces>({
    ville: "Conakry",
    tri: "match",
    per_page: 20,
  });
  // Brouillon : les filtres ne s'appliquent qu'à la validation du panneau.
  const [brouillon, setBrouillon] = useState<FiltresAnnonces>(filtres);

  const annonces = useApi(
    () => listingsAPI.rechercher({ ...filtres, q: recherche.trim() || undefined }),
    [filtres, recherche],
  );

  async function basculerFavori(listing: Listing) {
    annonces.muter((p) => ({
      ...p,
      listings: p.listings.map((l) => (l.id === listing.id ? { ...l, is_favorite: !l.is_favorite } : l)),
    }));
    try {
      await (listing.is_favorite ? favorisAPI.retirer(listing.id) : favorisAPI.ajouter(listing.id));
    } catch {
      annonces.muter((p) => ({
        ...p,
        listings: p.listings.map((l) =>
          l.id === listing.id ? { ...l, is_favorite: listing.is_favorite } : l,
        ),
      }));
    }
  }

  function appliquer() {
    setFiltres(brouillon);
    setFiltresOuverts(false);
  }

  function reinitialiser() {
    const neutre: FiltresAnnonces = { ville: "Conakry", tri: filtres.tri, per_page: 20 };
    setBrouillon(neutre);
    setFiltres(neutre);
    setFiltresOuverts(false);
  }

  const nbFiltresActifs = Object.entries(filtres).filter(
    ([cle, valeur]) =>
      !["ville", "tri", "per_page", "page"].includes(cle) && valeur !== undefined && valeur !== false,
  ).length;

  return (
    <div className="pb-8">
      {/* Recherche */}
      <div className="px-4 pt-6 pb-4" style={{ background: "#1E3A5F" }}>
        <h1 className="text-white font-bold mb-4" style={{ fontSize: "20px" }}>
          Annonces à Conakry
        </h1>
        <div className="relative">
          <Search
            size={18}
            className="absolute left-3.5 top-1/2 -translate-y-1/2"
            style={{ color: "#94A3B8" }}
          />
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Quartier, type de bien…"
            aria-label="Rechercher une annonce"
            className="w-full pl-10 pr-12 py-3 rounded-xl outline-none"
            style={{ background: "white", fontSize: "14px" }}
          />
          <button
            onClick={() => {
              setBrouillon(filtres);
              setFiltresOuverts(true);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg"
            style={{ background: nbFiltresActifs ? "#F97316" : "#F0F4FA", color: nbFiltresActifs ? "white" : "#1E3A5F" }}
            aria-label="Ouvrir les filtres"
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* Tri */}
      <div
        className="flex gap-2 px-4 py-3 overflow-x-auto"
        style={{ background: "#1E3A5F", borderBottom: "1px solid rgba(255,255,255,0.1)" }}
      >
        {TRIS.map((t) => (
          <button
            key={t.valeur}
            onClick={() => setFiltres((f) => ({ ...f, tri: t.valeur }))}
            className="px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 transition-all"
            style={{
              background: filtres.tri === t.valeur ? "#F97316" : "rgba(255,255,255,0.12)",
              color: filtres.tri === t.valeur ? "white" : "rgba(255,255,255,0.6)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Résultats */}
      <div className="px-4 py-3 flex items-center justify-between">
        <p className="text-gray-500 text-sm">
          {annonces.chargement ? (
            "Recherche…"
          ) : (
            <>
              <span className="font-bold" style={{ color: "#1E3A5F" }}>
                {annonces.data?.total ?? 0}
              </span>{" "}
              annonce{(annonces.data?.total ?? 0) > 1 ? "s" : ""}
            </>
          )}
        </p>
        {nbFiltresActifs > 0 && (
          <button onClick={reinitialiser} className="text-xs font-semibold" style={{ color: "#F97316" }}>
            Réinitialiser les filtres
          </button>
        )}
      </div>

      <div className="px-4 space-y-4">
        {annonces.chargement ? (
          <SqueletteCartes nombre={3} />
        ) : annonces.erreur ? (
          <Erreur message={annonces.erreur} onReessayer={annonces.recharger} />
        ) : !annonces.data?.listings.length ? (
          <ListeVide
            titre="Aucune annonce ne correspond"
            description="Élargissez votre budget ou retirez quelques filtres pour voir plus de biens."
            action={nbFiltresActifs ? { label: "Réinitialiser les filtres", onClick: reinitialiser } : undefined}
          />
        ) : (
          annonces.data.listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} onToggleFavori={basculerFavori} />
          ))
        )}
      </div>

      {/* Panneau de filtres */}
      {filtresOuverts && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setFiltresOuverts(false)} />
          <div
            className="relative w-full rounded-t-3xl p-6 space-y-5"
            style={{ background: "white", maxHeight: "85vh", overflowY: "auto" }}
          >
            <div className="flex items-center justify-between sticky top-0 bg-white pb-2">
              <h3 className="font-bold text-lg" style={{ color: "#1E3A5F" }}>
                Filtres
              </h3>
              <button
                onClick={() => setFiltresOuverts(false)}
                style={{ color: "#64748B" }}
                aria-label="Fermer les filtres"
              >
                <X size={22} />
              </button>
            </div>

            <div>
              <label htmlFor="f-quartier" className="block text-sm font-semibold text-gray-700 mb-2">
                Quartier
              </label>
              <select
                id="f-quartier"
                value={brouillon.quartier ?? ""}
                onChange={(e) => setBrouillon((f) => ({ ...f, quartier: e.target.value || undefined }))}
                className="w-full px-4 py-3 rounded-xl outline-none"
                style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" }}
              >
                <option value="">Tous les quartiers</option>
                {geo.quartiers.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="f-type" className="block text-sm font-semibold text-gray-700 mb-2">
                Type de bien
              </label>
              <select
                id="f-type"
                value={brouillon.type ?? ""}
                onChange={(e) => setBrouillon((f) => ({ ...f, type: e.target.value || undefined }))}
                className="w-full px-4 py-3 rounded-xl outline-none"
                style={{ background: "white", border: "1.5px solid #E2E8F0", fontSize: "15px" }}
              >
                <option value="">Tous les types</option>
                {geo.typesBien.map((t) => (
                  <option key={t.valeur} value={t.valeur}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="f-budget" className="block text-sm font-semibold text-gray-700 mb-2">
                Loyer maximum :{" "}
                <span style={{ color: "#F97316" }}>
                  {brouillon.prix_max
                    ? `${formatMontantCourt(brouillon.prix_max)} /mois`
                    : "sans limite"}
                </span>
              </label>
              <input
                id="f-budget"
                type="range"
                min={200_000}
                max={BUDGET_MAX}
                step={100_000}
                value={brouillon.prix_max ?? BUDGET_MAX}
                onChange={(e) => {
                  const valeur = Number(e.target.value);
                  setBrouillon((f) => ({ ...f, prix_max: valeur >= BUDGET_MAX ? undefined : valeur }));
                }}
                className="w-full accent-orange-500"
              />
              <div className="flex justify-between text-xs text-gray-400 mt-1">
                <span>200 k GNF</span>
                <span>10 M GNF +</span>
              </div>
            </div>

            <div>
              <label htmlFor="f-pieces" className="block text-sm font-semibold text-gray-700 mb-2">
                Pièces minimum
              </label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => {
                  const actif = brouillon.nb_pieces_min === n;
                  return (
                    <button
                      key={n}
                      onClick={() =>
                        setBrouillon((f) => ({ ...f, nb_pieces_min: actif ? undefined : n }))
                      }
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                      style={{
                        background: actif ? "#F97316" : "#F0F4FA",
                        color: actif ? "white" : "#64748B",
                      }}
                    >
                      {n}
                      {n === 5 ? "+" : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="block text-sm font-semibold text-gray-700 mb-2">Équipements</span>
              <div className="flex flex-wrap gap-2">
                {EQUIPEMENTS.map((eq) => {
                  const actif = Boolean(brouillon[eq.cle]);
                  return (
                    <button
                      key={eq.cle}
                      onClick={() => setBrouillon((f) => ({ ...f, [eq.cle]: actif ? undefined : true }))}
                      className="px-3 py-2 rounded-full text-xs font-semibold transition-colors"
                      style={{
                        background: actif ? "#F97316" : "#F0F4FA",
                        color: actif ? "white" : "#64748B",
                      }}
                    >
                      {eq.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <p className="font-semibold text-sm" style={{ color: "#1E293B" }}>
                  Annonces certifiées uniquement
                </p>
                <p className="text-xs text-gray-400">Biens vérifiés sur pièces par Tcheyna</p>
              </div>
              <button
                onClick={() =>
                  setBrouillon((f) => ({ ...f, certified_only: f.certified_only ? undefined : true }))
                }
                className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0"
                style={{ background: brouillon.certified_only ? "#F97316" : "#CBD5E1" }}
                aria-pressed={Boolean(brouillon.certified_only)}
                aria-label="Annonces certifiées uniquement"
              >
                <span
                  className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: brouillon.certified_only ? "translateX(26px)" : "translateX(4px)" }}
                />
              </button>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={reinitialiser}
                className="flex-1 py-4 rounded-2xl font-semibold"
                style={{ background: "#F0F4FA", color: "#64748B" }}
              >
                Réinitialiser
              </button>
              <button
                onClick={appliquer}
                className="flex-[2] py-4 rounded-2xl font-semibold text-white"
                style={{ background: "#F97316" }}
              >
                Voir les résultats
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
