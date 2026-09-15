/**
 * PageLegale.tsx — Coquille commune aux pages légales.
 *
 * Ces pages sont consultables sans compte : on ne peut pas exiger d'accepter
 * des conditions qu'il faudrait un compte pour lire.
 */
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

export const DERNIERE_MAJ = "15 septembre 2026";

export function PageLegale({
  titre,
  sousTitre,
  children,
}: {
  titre: string;
  sousTitre: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen" style={{ background: "#F0F4FA" }}>
      <div className="px-4 pt-6 pb-6" style={{ background: "#1E3A5F" }}>
        <Link to="/" className="inline-flex items-center gap-2 text-white/70 text-sm mb-4">
          <ArrowLeft size={17} />
          Retour
        </Link>
        <h1 className="text-white font-bold" style={{ fontSize: "22px" }}>
          {titre}
        </h1>
        <p className="text-white/60 text-sm mt-1">{sousTitre}</p>
        <p className="text-white/40 text-xs mt-3">Dernière mise à jour : {DERNIERE_MAJ}</p>
      </div>

      <div className="px-4 py-6 max-w-2xl mx-auto">
        <div
          className="rounded-2xl p-6 space-y-6"
          style={{ background: "white", boxShadow: "0 2px 12px rgba(30,58,95,0.07)" }}
        >
          {children}
        </div>

        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 justify-center text-xs">
          <Link to="/legal/cgu" className="underline underline-offset-2" style={{ color: "#64748B" }}>
            Conditions générales
          </Link>
          <Link to="/legal/confidentialite" className="underline underline-offset-2" style={{ color: "#64748B" }}>
            Confidentialité
          </Link>
          <Link to="/legal/mentions" className="underline underline-offset-2" style={{ color: "#64748B" }}>
            Mentions légales
          </Link>
        </div>
      </div>
    </div>
  );
}

export function Section({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-bold" style={{ color: "#1E3A5F", fontSize: "16px" }}>
        {titre}
      </h2>
      <div className="space-y-2 text-sm leading-relaxed" style={{ color: "#334155" }}>
        {children}
      </div>
    </section>
  );
}

export function Liste({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5 pl-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span style={{ color: "#F97316", flexShrink: 0 }}>•</span>
          <span className="flex-1">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Élément d'identité juridique que l'éditeur doit renseigner avant toute
 * exploitation réelle. Volontairement visible : une mention légale incomplète
 * qui aurait l'air complète serait pire qu'un trou signalé.
 */
export function ACompleter({ quoi }: { quoi: string }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded font-semibold"
      style={{ background: "#FEF3C7", color: "#92400E", fontSize: "12.5px" }}
    >
      [à compléter : {quoi}]
    </span>
  );
}
