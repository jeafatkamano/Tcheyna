/**
 * Avatar.tsx — Photo de profil, avec repli sur les initiales.
 *
 * Mettre un visage sur un nom fait partie du dispositif de confiance : un
 * propriétaire identifiable rassure avant même la première visite. Tant
 * qu'aucune photo n'est déposée, les initiales tiennent lieu de repère.
 */
import { urlFichier } from "../api";
import { initiales } from "../lib/format";

interface Props {
  nom?: string | null;
  url?: string | null;
  /** Côté du carré, en pixels. */
  taille?: number;
  /** Rond pour les personnes, arrondi pour les vignettes de liste. */
  forme?: "rond" | "arrondi";
  /** Sur fond bleu nuit, les initiales s'affichent en clair. */
  surFonce?: boolean;
  className?: string;
}

export function Avatar({
  nom,
  url,
  taille = 40,
  forme = "arrondi",
  surFonce = false,
  className = "",
}: Props) {
  const source = urlFichier(url);
  const rayon = forme === "rond" ? "50%" : `${Math.round(taille * 0.28)}px`;

  const style = {
    width: taille,
    height: taille,
    borderRadius: rayon,
    fontSize: Math.max(Math.round(taille * 0.36), 10),
    flexShrink: 0,
  } as const;

  if (source) {
    return (
      <img
        src={source}
        alt={nom ? `Photo de ${nom}` : "Photo de profil"}
        className={`object-cover ${className}`}
        style={style}
        loading="lazy"
        onError={(e) => {
          // Une photo supprimée du stockage ne doit pas laisser un cadre vide :
          // on masque l'image et le repli en initiales prend le relais.
          (e.currentTarget as HTMLImageElement).style.display = "none";
          const repli = e.currentTarget.nextElementSibling as HTMLElement | null;
          if (repli) repli.style.display = "flex";
        }}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center font-bold ${className}`}
      style={{
        ...style,
        background: surFonce ? "rgba(255,255,255,0.2)" : "#1E3A5F",
        color: "white",
      }}
      aria-hidden={!nom}
    >
      {initiales(nom)}
    </span>
  );
}

/**
 * Variante qui garde le repli en initiales dans le DOM, prêt à prendre la
 * suite si l'image ne se charge pas.
 */
export function AvatarResilient(props: Props) {
  const source = urlFichier(props.url);
  if (!source) return <Avatar {...props} />;

  const { taille = 40, forme = "arrondi", surFonce = false, nom } = props;
  const rayon = forme === "rond" ? "50%" : `${Math.round(taille * 0.28)}px`;

  return (
    <span style={{ position: "relative", display: "inline-block", flexShrink: 0 }}>
      <Avatar {...props} />
      <span
        className="items-center justify-center font-bold"
        style={{
          display: "none",
          position: "absolute",
          inset: 0,
          width: taille,
          height: taille,
          borderRadius: rayon,
          fontSize: Math.max(Math.round(taille * 0.36), 10),
          background: surFonce ? "rgba(255,255,255,0.2)" : "#1E3A5F",
          color: "white",
        }}
      >
        {initiales(nom)}
      </span>
    </span>
  );
}
