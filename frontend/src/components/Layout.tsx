/**
 * Layout.tsx — Coque de l'application connectée : barre haute, menu latéral et
 * navigation basse. La navigation dépend du rôle réel de l'utilisateur.
 */
import {
  Bell,
  ChevronRight,
  Heart,
  Home,
  LogOut,
  Menu,
  MessageSquare,
  Receipt,
  Search,
  Settings,
  Shield,
  User as UserIcon,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { messagesAPI, notificationsAPI } from "../api";
import { useAuth } from "../context/AuthContext";
import { initiales } from "../lib/format";
import { BadgeVerification } from "./BadgeVerification";
import { Chargement } from "./Etats";

const NAV_LOCATAIRE = [
  { path: "/tenant/dashboard", icon: Home, label: "Accueil" },
  { path: "/tenant/listings", icon: Search, label: "Annonces" },
  { path: "/tenant/matches", icon: Users, label: "Candidatures" },
  { path: "/messages", icon: MessageSquare, label: "Messages", compteur: "messages" as const },
  { path: "/tenant/profile", icon: UserIcon, label: "Profil" },
];

const NAV_PROPRIETAIRE = [
  { path: "/owner/dashboard", icon: Home, label: "Accueil" },
  { path: "/owner/listings", icon: Search, label: "Mes biens" },
  { path: "/owner/matches", icon: Users, label: "Candidats" },
  { path: "/messages", icon: MessageSquare, label: "Messages", compteur: "messages" as const },
  { path: "/owner/profile", icon: UserIcon, label: "Profil" },
];

const NAV_ADMIN = [
  { path: "/admin", icon: Shield, label: "Vérification" },
  { path: "/admin/users", icon: Users, label: "Utilisateurs" },
  { path: "/messages", icon: MessageSquare, label: "Messages", compteur: "messages" as const },
];

const LIENS_SECONDAIRES_LOCATAIRE = [
  { path: "/tenant/favoris", icon: Heart, label: "Mes favoris" },
  { path: "/paiements", icon: Receipt, label: "Mes paiements" },
];

const LIENS_SECONDAIRES_PROPRIETAIRE = [{ path: "/paiements", icon: Receipt, label: "Mes paiements" }];

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, chargement, deconnecter } = useAuth();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [messagesNonLus, setMessagesNonLus] = useState(0);
  const [notifsNonLues, setNotifsNonLues] = useState(0);

  // Les compteurs sont rafraîchis à chaque navigation : suffisant sans
  // websocket, et cela évite un sondage permanent.
  useEffect(() => {
    if (!user) return;
    let vivant = true;
    void messagesAPI
      .nonLus()
      .then((d) => vivant && setMessagesNonLus(d.non_lus))
      .catch(() => undefined);
    void notificationsAPI
      .compteur()
      .then((d) => vivant && setNotifsNonLues(d.non_lues))
      .catch(() => undefined);
    return () => {
      vivant = false;
    };
  }, [user, location.pathname]);

  useEffect(() => {
    setMenuOuvert(false);
  }, [location.pathname]);

  if (chargement) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#F0F4FA" }}>
        <Chargement texte="Chargement de votre espace…" />
      </div>
    );
  }

  if (!user) return null; // RequireAuth s'occupe de la redirection

  const estLocataire = user.role === "tenant";
  const estAdmin = user.role === "admin";
  const nav = estAdmin ? NAV_ADMIN : estLocataire ? NAV_LOCATAIRE : NAV_PROPRIETAIRE;
  const liensSecondaires = estAdmin
    ? []
    : estLocataire
      ? LIENS_SECONDAIRES_LOCATAIRE
      : LIENS_SECONDAIRES_PROPRIETAIRE;

  const libelleRole = {
    tenant: "Locataire",
    landlord: "Propriétaire",
    agency: "Agence",
    admin: "Administrateur",
  }[user.role];

  const estActif = (chemin: string) =>
    chemin === "/admin" ? location.pathname === chemin : location.pathname.startsWith(chemin);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#F0F4FA" }}>
      {/* Barre haute */}
      <header
        className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 shadow-sm"
        style={{ background: "#1E3A5F" }}
      >
        <div className="flex items-center gap-2">
          <button
            className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            onClick={() => setMenuOuvert(true)}
            aria-label="Ouvrir le menu"
          >
            <Menu size={20} />
          </button>
          <Link to={nav[0].path} className="text-white font-bold tracking-tight" style={{ fontSize: "20px" }}>
            tcheyna
          </Link>
        </div>

        <div className="flex items-center gap-1">
          <Link
            to="/notifications"
            className="relative p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={`Notifications${notifsNonLues ? ` (${notifsNonLues} non lues)` : ""}`}
          >
            <Bell size={20} />
            {notifsNonLues > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-white flex items-center justify-center font-bold"
                style={{ background: "#F97316", fontSize: "10px" }}
              >
                {notifsNonLues > 9 ? "9+" : notifsNonLues}
              </span>
            )}
          </Link>
          <Link
            to={estAdmin ? "/admin" : estLocataire ? "/tenant/profile" : "/owner/profile"}
            className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-semibold ml-1"
          >
            {initiales(user.full_name)}
          </Link>
        </div>
      </header>

      {/* Menu latéral */}
      {menuOuvert && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOuvert(false)} />
          <div
            className="relative w-72 max-w-full h-full flex flex-col shadow-xl"
            style={{ background: "#1E3A5F" }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <span className="text-white font-bold text-xl tracking-tight">tcheyna</span>
              <button
                className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10"
                onClick={() => setMenuOuvert(false)}
                aria-label="Fermer le menu"
              >
                <X size={20} />
              </button>
            </div>

            <div className="px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-lg">
                  {initiales(user.full_name)}
                </div>
                <div className="min-w-0">
                  <p className="text-white font-semibold truncate">{user.full_name}</p>
                  <p className="text-white/60 text-sm">{libelleRole}</p>
                </div>
              </div>
              {!estAdmin && (
                <div className="mt-3">
                  <BadgeVerification level={user.trust_level} size="sm" />
                </div>
              )}
            </div>

            <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
              {[...nav, ...liensSecondaires].map((item) => {
                const actif = estActif(item.path);
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors"
                    style={{
                      background: actif ? "rgba(249,115,22,0.2)" : "transparent",
                      color: actif ? "#F97316" : "rgba(255,255,255,0.7)",
                    }}
                  >
                    <item.icon size={20} />
                    <span className="font-medium">{item.label}</span>
                    {actif && <ChevronRight size={16} className="ml-auto" />}
                  </Link>
                );
              })}
            </nav>

            <div className="px-3 py-4 border-t border-white/10 space-y-1">
              <Link
                to={estLocataire ? "/tenant/profile" : "/owner/profile"}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                <Settings size={20} />
                <span className="font-medium">Paramètres du compte</span>
              </Link>
              <button
                onClick={() => {
                  deconnecter();
                  navigate("/");
                }}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                <LogOut size={20} />
                <span className="font-medium">Déconnexion</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 pb-24">
        <Outlet />
      </main>

      {/* Navigation basse */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-around border-t border-white/10 shadow-lg"
        style={{ background: "#1E3A5F" }}
      >
        {nav.map((item) => {
          const actif = estActif(item.path);
          const badge = item.compteur === "messages" ? messagesNonLus : 0;
          return (
            <Link
              key={item.path}
              to={item.path}
              className="relative flex flex-col items-center gap-1 py-3 px-2 flex-1 transition-colors"
              style={{ color: actif ? "#F97316" : "rgba(255,255,255,0.55)" }}
            >
              <span className="relative">
                <item.icon size={22} />
                {badge > 0 && (
                  <span
                    className="absolute -top-1 -right-2 min-w-[16px] h-4 px-1 rounded-full text-white flex items-center justify-center font-bold"
                    style={{ background: "#F97316", fontSize: "9px" }}
                  >
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
              <span style={{ fontSize: "10px", fontWeight: 500 }}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
