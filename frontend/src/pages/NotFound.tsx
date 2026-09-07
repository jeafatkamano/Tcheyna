import { Home, Search } from "lucide-react";
import { Link } from "react-router";

import { useAuth } from "../context/AuthContext";

export function NotFound() {
  const { user, accueilDuRole } = useAuth();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 text-center"
      style={{ background: "linear-gradient(160deg, #0F2040 0%, #1E3A5F 60%, #0F2040 100%)" }}
    >
      <span className="text-white font-bold tracking-tight mb-8" style={{ fontSize: "24px" }}>
        tcheyna
      </span>

      <p className="font-bold mb-2" style={{ color: "#F97316", fontSize: "56px", lineHeight: 1 }}>
        404
      </p>
      <h1 className="text-white font-bold mb-3" style={{ fontSize: "22px" }}>
        Page introuvable
      </h1>
      <p className="text-white/60 mb-10 max-w-xs" style={{ fontSize: "15px", lineHeight: 1.6 }}>
        Cette page n'existe pas ou a été déplacée.
      </p>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <Link
          to={user ? accueilDuRole() : "/"}
          className="flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold text-white"
          style={{ background: "#F97316", fontSize: "15px" }}
        >
          <Home size={18} />
          {user ? "Retour à mon espace" : "Retour à l'accueil"}
        </Link>
        <Link
          to={user?.role === "tenant" ? "/tenant/listings" : "/"}
          className="flex items-center justify-center gap-2 py-4 rounded-2xl font-semibold"
          style={{
            background: "rgba(255,255,255,0.08)",
            color: "white",
            border: "1.5px solid rgba(255,255,255,0.2)",
            fontSize: "15px",
          }}
        >
          <Search size={18} />
          Voir les annonces
        </Link>
      </div>
    </div>
  );
}
