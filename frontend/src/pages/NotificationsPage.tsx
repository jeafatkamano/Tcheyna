import {
  Bell,
  CheckCheck,
  Home,
  MessageSquare,
  Receipt,
  ShieldCheck,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router";

import { notificationsAPI, type Notification } from "../api";
import { Erreur, ListeVide, SqueletteCartes } from "../components/Etats";
import { useAction, useApi } from "../hooks/useApi";
import { formatRelatif } from "../lib/format";

const ICONES: Record<string, { icone: LucideIcon; couleur: string; fond: string }> = {
  nouvelle_candidature: { icone: Users, couleur: "#F97316", fond: "#FFF7ED" },
  candidature_acceptee: { icone: CheckCheck, couleur: "#10B981", fond: "#ECFDF5" },
  candidature_refusee: { icone: Users, couleur: "#94A3B8", fond: "#F1F5F9" },
  nouveau_message: { icone: MessageSquare, couleur: "#3B82F6", fond: "#EFF6FF" },
  annonce_certifiee: { icone: ShieldCheck, couleur: "#10B981", fond: "#ECFDF5" },
  annonce_refusee: { icone: Home, couleur: "#DC2626", fond: "#FEE2E2" },
  paiement_recu: { icone: Receipt, couleur: "#8B5CF6", fond: "#F5F3FF" },
  nouvel_avis: { icone: Star, couleur: "#F59E0B", fond: "#FFFBEB" },
  niveau_confiance: { icone: ShieldCheck, couleur: "#1E3A5F", fond: "#EFF6FF" },
};

const PAR_DEFAUT = { icone: Bell, couleur: "#64748B", fond: "#F1F5F9" };

export function NotificationsPage() {
  const navigate = useNavigate();
  const notifications = useApi(() => notificationsAPI.liste(), []);
  const suppression = useAction(notificationsAPI.supprimer);
  const toutLire = useAction(notificationsAPI.toutMarquerLu);

  async function ouvrir(notif: Notification) {
    if (!notif.lu) {
      notifications.muter((p) => ({
        ...p,
        notifications: p.notifications.map((n) => (n.id === notif.id ? { ...n, lu: true } : n)),
        non_lues: Math.max(0, p.non_lues - 1),
      }));
      void notificationsAPI.marquerLue(notif.id).catch(() => undefined);
    }
    if (notif.lien) navigate(notif.lien);
  }

  async function supprimer(notif: Notification) {
    notifications.muter((p) => ({
      ...p,
      notifications: p.notifications.filter((n) => n.id !== notif.id),
      non_lues: notif.lu ? p.non_lues : Math.max(0, p.non_lues - 1),
    }));
    const ok = await suppression.executer(notif.id);
    if (!ok) void notifications.recharger();
  }

  const nonLues = notifications.data?.non_lues ?? 0;

  return (
    <div className="pb-8">
      <div className="px-4 pt-6 pb-5" style={{ background: "#1E3A5F" }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-white font-bold mb-1" style={{ fontSize: "20px" }}>
              Notifications
            </h1>
            <p className="text-white/60 text-sm">
              {nonLues ? `${nonLues} non lue${nonLues > 1 ? "s" : ""}` : "Tout est à jour"}
            </p>
          </div>
          {nonLues > 0 && (
            <button
              onClick={async () => {
                const ok = await toutLire.executer();
                if (ok) void notifications.recharger();
              }}
              disabled={toutLire.enCours}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50"
              style={{ background: "rgba(249,115,22,0.2)", color: "#F97316" }}
            >
              Tout marquer comme lu
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pt-5 space-y-3">
        {notifications.chargement ? (
          <SqueletteCartes nombre={3} />
        ) : notifications.erreur ? (
          <Erreur message={notifications.erreur} onReessayer={notifications.recharger} />
        ) : !notifications.data?.notifications.length ? (
          <ListeVide
            titre="Aucune notification"
            description="Vous serez prévenu ici des candidatures, messages, certifications et paiements."
            icone={<Bell size={26} style={{ color: "#94A3B8" }} />}
          />
        ) : (
          notifications.data.notifications.map((notif) => {
            const config = ICONES[notif.type] ?? PAR_DEFAUT;
            const Icone = config.icone;

            return (
              <div
                key={notif.id}
                className="flex items-start gap-3 p-4 rounded-2xl"
                style={{
                  background: "white",
                  boxShadow: "0 2px 12px rgba(30,58,95,0.07)",
                  border: notif.lu ? "1.5px solid transparent" : "1.5px solid #FED7AA",
                }}
              >
                <button
                  onClick={() => ouvrir(notif)}
                  className="flex items-start gap-3 flex-1 min-w-0 text-left"
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: config.fond }}
                  >
                    <Icone size={19} style={{ color: config.couleur }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm mb-0.5"
                      style={{ color: "#1E293B", fontWeight: notif.lu ? 500 : 700 }}
                    >
                      {notif.titre}
                    </p>
                    {notif.contenu && (
                      <p className="text-sm text-gray-500 leading-relaxed">{notif.contenu}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">{formatRelatif(notif.created_at)}</p>
                  </div>
                </button>

                <button
                  onClick={() => supprimer(notif)}
                  className="p-1.5 rounded-lg flex-shrink-0"
                  style={{ color: "#CBD5E1" }}
                  aria-label="Supprimer la notification"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
