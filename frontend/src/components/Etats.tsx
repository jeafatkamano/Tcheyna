/**
 * Etats.tsx — États transverses : chargement, erreur, liste vide.
 *
 * Centralisés pour que toutes les pages réagissent de la même façon plutôt que
 * d'afficher un écran blanc quand l'API ne répond pas.
 */
import { AlertCircle, Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

export function Chargement({ texte = "Chargement…" }: { texte?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3" role="status">
      <div
        className="w-8 h-8 rounded-full border-[3px] animate-spin"
        style={{ borderColor: "#E2E8F0", borderTopColor: "#F97316" }}
      />
      <p className="text-sm text-gray-400">{texte}</p>
    </div>
  );
}

/** Squelettes de cartes — évite le saut de mise en page pendant le chargement. */
export function SqueletteCartes({ nombre = 3 }: { nombre?: number }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: nombre }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl overflow-hidden animate-pulse"
          style={{ background: "white", boxShadow: "0 2px 16px rgba(30,58,95,0.08)" }}
        >
          <div className="h-44" style={{ background: "#E2E8F0" }} />
          <div className="p-4 space-y-2">
            <div className="h-4 rounded w-3/4" style={{ background: "#E2E8F0" }} />
            <div className="h-3 rounded w-1/2" style={{ background: "#EEF2F7" }} />
            <div className="h-5 rounded w-1/3 mt-3" style={{ background: "#E2E8F0" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ErreurProps {
  message: string;
  onReessayer?: () => void;
}

export function Erreur({ message, onReessayer }: ErreurProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center gap-3">
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: "#FEE2E2" }}
      >
        <AlertCircle size={24} style={{ color: "#DC2626" }} />
      </div>
      <p className="font-semibold" style={{ color: "#1E293B" }}>
        Une erreur est survenue
      </p>
      <p className="text-sm text-gray-500 max-w-xs">{message}</p>
      {onReessayer && (
        <button
          onClick={onReessayer}
          className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
          style={{ background: "#1E3A5F" }}
        >
          <RefreshCw size={15} />
          Réessayer
        </button>
      )}
    </div>
  );
}

interface VideProps {
  titre: string;
  description?: string;
  icone?: ReactNode;
  action?: { label: string; to: string } | { label: string; onClick: () => void };
}

export function ListeVide({ titre, description, icone, action }: VideProps) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center gap-3">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center"
        style={{ background: "#F0F4FA" }}
      >
        {icone ?? <Inbox size={26} style={{ color: "#94A3B8" }} />}
      </div>
      <p className="font-bold" style={{ color: "#1E293B", fontSize: "15px" }}>
        {titre}
      </p>
      {description && <p className="text-sm text-gray-500 max-w-xs leading-relaxed">{description}</p>}
      {action &&
        ("to" in action ? (
          <Link
            to={action.to}
            className="mt-2 inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#F97316" }}
          >
            {action.label}
          </Link>
        ) : (
          <button
            onClick={action.onClick}
            className="mt-2 inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold text-white"
            style={{ background: "#F97316" }}
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}

/** Bandeau d'erreur inline, pour les formulaires. */
export function MessageErreur({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      className="flex items-start gap-2 px-3.5 py-3 rounded-xl"
      style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}
      role="alert"
    >
      <AlertCircle size={17} style={{ color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
      <p className="text-sm" style={{ color: "#B91C1C" }}>
        {message}
      </p>
    </div>
  );
}

/** Bandeau de confirmation inline. */
export function MessageSucces({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      className="flex items-start gap-2 px-3.5 py-3 rounded-xl"
      style={{ background: "#ECFDF5", border: "1px solid #A7F3D0" }}
      role="status"
    >
      <p className="text-sm font-medium" style={{ color: "#065F46" }}>
        {message}
      </p>
    </div>
  );
}
