/**
 * ListingsPage.tsx — Recherche d'annonces (maquette Annonces, lot 3.15a).
 *
 * En-tête : Louer / Acheter, recherche, bouton de filtres avec le nombre de
 * filtres actifs. Sous l'en-tête : pastilles d'équipements en défilement
 * horizontal (appliquées tout de suite), nombre de résultats et tri. Le
 * panneau de filtres complet reste, en feuille qui monte du bas.
 */
import { ChevronDown, Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";

import { favorisAPI, listingsAPI, type FiltresAnnonces, type Listing } from "../../api";
import { EnTetePage } from "../../components/EnTetePage";
import { Erreur, ListeVide, SqueletteCartes } from "../../components/Etats";
import { FeuilleBas } from "../../components/FeuilleBas";
import { ListingCard } from "../../components/ListingCard";
import { Pastille } from "../../components/Pastille";
import { Segment } from "../../components/Segment";
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

const TRANSACTIONS = [
  { valeur: "location", label: "Louer" },
  { valeur: "vente", label: "Acheter" },
] as const;

const BUDGET_MAX = 10_000_000;

const STYLE_CHAMP = { background: "white", border: "1.5px solid #CBD5E1", fontSize: "15px", color: "#1E293B" };

export function ListingsPage() {
  const geo = useGeo("Guinée", "Conakry");

  const [recherche, setRecherche] = useState("");
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const [filtres, setFiltres] = useState<FiltresAnnonces>({
    ville: "Conakry",
    transaction: "location",
    tri: "match",
    per_page: 20,
  });
  // Brouillon : les filtres du panneau ne s'appliquent qu'à sa validation.
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
    const neutre: FiltresAnnonces = {
      ville: "Conakry",
      transaction: filtres.transaction,
      tri: filtres.tri,
      per_page: 20,
    };
    setBrouillon(neutre);
    setFiltres(neutre);
    setFiltresOuverts(false);
  }

  function changerTransaction(transaction: "location" | "vente") {
    // Un tri par compatibilité n'existe pas à la vente.
    setFiltres((f) => ({
      ...f,
      transaction,
      tri: transaction === "vente" && f.tri === "match" ? "recent" : f.tri,
    }));
  }

  const nbFiltresActifs = Object.entries(filtres).filter(
    ([cle, valeur]) =>
      !["ville", "transaction", "tri", "per_page", "page"].includes(cle) &&
      valeur !== undefined &&
      valeur !== false,
  ).length;

  const estVente = filtres.transaction === "vente";
  const total = annonces.data?.total ?? 0;

  return (
    <div className="pb-6">
      <EnTetePage titre={estVente ? "Biens à vendre" : "Annonces"}>
        {/* Louer et acheter sont deux marchés : on n'en montre qu'un à la fois. */}
        <Segment
          sombre
          libelle="Type de recherche"
          options={TRANSACTIONS}
          valeur={filtres.transaction ?? "location"}
          onChange={changerTransaction}
        />
        <div className="flex gap-2.5">
          <div className="relative grow">
            <Search
              size={18}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: "#64748B" }}
              aria-hidden="true"
            />
            <input
              type="search"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
              placeholder="Quartier, type de bien…"
              aria-label="Rechercher une annonce"
              enterKeyHint="search"
              className="w-full h-12 pl-[42px] pr-3.5 rounded-[14px] outline-none border-0 bg-white"
              style={{ fontSize: 15, color: "#1E293B" }}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setBrouillon(filtres);
              setFiltresOuverts(true);
            }}
            className="relative w-12 h-12 shrink-0 rounded-[14px] flex items-center justify-center text-white"
            style={{ background: "#F97316" }}
            aria-label={nbFiltresActifs ? `Filtres (${nbFiltresActifs} actifs)` : "Filtres"}
          >
            <SlidersHorizontal size={20} aria-hidden="true" />
            {nbFiltresActifs > 0 && (
              <span
                className="absolute -top-1 -right-1 w-[18px] h-[18px] rounded-full bg-white flex items-center justify-center font-extrabold"
                style={{ color: "#C2410C", fontSize: 11 }}
                aria-hidden="true"
              >
                {nbFiltresActifs}
              </span>
            )}
          </button>
        </div>
      </EnTetePage>

      {/* Équipements : appliqués tout de suite */}
      <div
        className="flex gap-2 px-5 pt-3.5 pb-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: "none" }}
        role="group"
        aria-label="Équipements"
      >
        {EQUIPEMENTS.map((eq) => {
          const actif = Boolean(filtres[eq.cle]);
          return (
            <Pastille
              key={eq.cle}
              actif={actif}
              onClick={() => setFiltres((f) => ({ ...f, [eq.cle]: actif ? undefined : true }))}
            >
              {eq.label}
            </Pastille>
          );
        })}
      </div>

      {/* Résultats et tri */}
      <div className="flex items-center justify-between gap-3 px-5 pt-2.5 pb-1.5">
        <p className="m-0" style={{ fontSize: 13, color: "#475569" }} aria-live="polite">
          {annonces.chargement ? (
            "Recherche…"
          ) : (
            <>
              <strong style={{ color: "#1E293B" }}>
                {total} {total > 1 ? "biens" : "bien"}
              </strong>{" "}
              à Conakry
            </>
          )}
        </p>
        <div className="relative shrink-0">
          <select
            aria-label="Trier par"
            value={filtres.tri}
            onChange={(e) => setFiltres((f) => ({ ...f, tri: e.target.value as FiltresAnnonces["tri"] }))}
            className="h-11 pl-2 pr-6 appearance-none bg-transparent font-bold outline-none text-right"
            style={{ fontSize: 13, color: "#1E3A5F" }}
          >
            {TRIS.filter((t) => !(estVente && t.valeur === "match")).map((t) => (
              <option key={t.valeur} value={t.valeur}>
                {t.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none"
            color="#1E3A5F"
            aria-hidden="true"
          />
        </div>
      </div>
      {nbFiltresActifs > 0 && (
        <div className="px-5">
          <button
            type="button"
            onClick={reinitialiser}
            className="min-h-11 font-bold"
            style={{ fontSize: 13, color: "#C2410C" }}
          >
            Réinitialiser les filtres
          </button>
        </div>
      )}

      <div className="px-5 pt-1.5 flex flex-col gap-3.5">
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

      {/* Panneau de filtres : feuille qui monte du bas */}
      {filtresOuverts && (
        <FeuilleBas
          titre="Filtres"
          onFermer={() => setFiltresOuverts(false)}
          pied={
            <div className="flex gap-3">
              <button
                type="button"
                onClick={reinitialiser}
                className="flex-1 h-14 rounded-2xl font-bold"
                style={{ background: "#F0F4FA", color: "#475569" }}
              >
                Réinitialiser
              </button>
              <button
                type="button"
                onClick={appliquer}
                className="flex-[2] h-14 rounded-2xl font-bold text-white"
                style={{ background: "#F97316" }}
              >
                Voir les résultats
              </button>
            </div>
          }
        >
          <div>
            <label htmlFor="f-quartier" className="block text-sm font-semibold mb-2" style={{ color: "#334155" }}>
              Quartier
            </label>
            <select
              id="f-quartier"
              value={brouillon.quartier ?? ""}
              onChange={(e) => setBrouillon((f) => ({ ...f, quartier: e.target.value || undefined }))}
              className="w-full h-[54px] px-4 rounded-2xl outline-none"
              style={STYLE_CHAMP}
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
            <label htmlFor="f-type" className="block text-sm font-semibold mb-2" style={{ color: "#334155" }}>
              Type de bien
            </label>
            <select
              id="f-type"
              value={brouillon.type ?? ""}
              onChange={(e) => setBrouillon((f) => ({ ...f, type: e.target.value || undefined }))}
              className="w-full h-[54px] px-4 rounded-2xl outline-none"
              style={STYLE_CHAMP}
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
            <label htmlFor="f-budget" className="block text-sm font-semibold mb-2" style={{ color: "#334155" }}>
              Loyer maximum :{" "}
              <span style={{ color: "#C2410C" }}>
                {brouillon.prix_max ? `${formatMontantCourt(brouillon.prix_max)} /mois` : "sans limite"}
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
            <div className="flex justify-between text-xs mt-1" style={{ color: "#64748B" }}>
              <span>200 k GNF</span>
              <span>10 M GNF +</span>
            </div>
          </div>

          <div role="group" aria-labelledby="f-pieces">
            <span id="f-pieces" className="block text-sm font-semibold mb-2" style={{ color: "#334155" }}>
              Pièces minimum
            </span>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((n) => {
                const actif = brouillon.nb_pieces_min === n;
                return (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={actif}
                    onClick={() => setBrouillon((f) => ({ ...f, nb_pieces_min: actif ? undefined : n }))}
                    className="flex-1 h-11 rounded-xl text-sm font-bold"
                    style={{ background: actif ? "#1E3A5F" : "#F0F4FA", color: actif ? "white" : "#475569" }}
                  >
                    {n}
                    {n === 5 ? "+" : ""}
                  </button>
                );
              })}
            </div>
          </div>

          <div role="group" aria-labelledby="f-equipements">
            <span id="f-equipements" className="block text-sm font-semibold mb-2" style={{ color: "#334155" }}>
              Équipements
            </span>
            <div className="flex flex-wrap gap-2">
              {EQUIPEMENTS.map((eq) => {
                const actif = Boolean(brouillon[eq.cle]);
                return (
                  <Pastille
                    key={eq.cle}
                    actif={actif}
                    onClick={() => setBrouillon((f) => ({ ...f, [eq.cle]: actif ? undefined : true }))}
                  >
                    {eq.label}
                  </Pastille>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="m-0 font-semibold text-sm" style={{ color: "#1E293B" }}>
                Annonces certifiées uniquement
              </p>
              <p className="m-0 text-xs" style={{ color: "#64748B" }}>
                Biens vérifiés sur pièces par Tcheyna
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBrouillon((f) => ({ ...f, certified_only: f.certified_only ? undefined : true }))}
              className="relative w-12 h-11 shrink-0 flex items-center"
              aria-pressed={Boolean(brouillon.certified_only)}
              aria-label="Annonces certifiées uniquement"
            >
              <span
                className="relative w-12 h-6 rounded-full transition-colors"
                style={{ background: brouillon.certified_only ? "#F97316" : "#CBD5E1" }}
              >
                <span
                  className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform"
                  style={{ transform: brouillon.certified_only ? "translateX(26px)" : "translateX(4px)" }}
                />
              </span>
            </button>
          </div>
        </FeuilleBas>
      )}
    </div>
  );
}
