/**
 * coque.ts — Ce que la coque de l'espace connecté (Layout) partage avec les
 * pages qui dessinent leur propre en-tête (lot 3.15a) : ouverture du menu
 * latéral et compteurs.
 *
 * Une route déclare son propre en-tête par `handle: { enTetePropre: true }`
 * (routes.tsx) : Layout masque alors sa barre haute.
 */
import { createContext, useContext } from "react";

export interface Coque {
  /** Ouvre le menu latéral (favoris, paiements, paramètres, déconnexion). */
  ouvrirMenu?: () => void;
  notifsNonLues: number;
  messagesNonLus: number;
}

export const CoqueContext = createContext<Coque>({ notifsNonLues: 0, messagesNonLus: 0 });

export function useCoque(): Coque {
  return useContext(CoqueContext);
}

export interface PoigneeRoute {
  enTetePropre?: boolean;
}
