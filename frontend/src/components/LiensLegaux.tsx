/**
 * LiensLegaux.tsx — Accès aux pages légales depuis l'espace connecté.
 *
 * Les conditions acceptées à l'inscription doivent rester consultables après
 * coup, sans avoir à se déconnecter pour retrouver le pied de page public.
 */
import { Link } from "react-router";

const LIENS = [
  { to: "/legal/cgu", label: "Conditions générales" },
  { to: "/legal/confidentialite", label: "Confidentialité" },
  { to: "/legal/mentions", label: "Mentions légales" },
];

export function LiensLegaux() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 justify-center pt-5 mt-2 border-t border-gray-100">
      {LIENS.map((lien) => (
        <Link
          key={lien.to}
          to={lien.to}
          className="text-xs underline underline-offset-2"
          style={{ color: "#94A3B8" }}
        >
          {lien.label}
        </Link>
      ))}
    </div>
  );
}
