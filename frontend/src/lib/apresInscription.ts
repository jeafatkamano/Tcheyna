/**
 * apresInscription.ts — Destination qui suit une inscription réussie (lot 3.14).
 *
 * `inscrire()` renseigne la session avant que RegisterPage ait pu naviguer :
 * la garde RedirectIfAuth de /inscription voit alors un utilisateur connecté
 * et le renverrait vers son espace, en sautant l'écran du code SMS. La
 * destination est donc fixée avant l'appel ; la garde la suit, et elle est
 * effacée dès que l'inscription échoue ou que la page d'inscription disparaît.
 */
import type { NavigateOptions } from "react-router";

export interface Destination {
  vers: string;
  state?: NavigateOptions["state"];
}

let destination: Destination | null = null;

export function fixerDestinationApresInscription(d: Destination | null): void {
  destination = d;
}

export function destinationApresInscription(): Destination | null {
  return destination;
}
