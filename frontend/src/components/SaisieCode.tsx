/**
 * SaisieCode.tsx — Code à 6 chiffres en six cases (lot 3.14, maquette CodeSMS).
 *
 * Le code est une chaîne continue de 0 à 6 chiffres :
 *   - un chiffre saisi avance à la case suivante ;
 *   - retour arrière dans une case vide efface la précédente et y revient ;
 *   - un code collé, ou proposé par Android (autocomplete="one-time-code" sur
 *     la première case), se répartit dans les cases à partir de celle qui a
 *     le focus ;
 *   - une case vide plus loin que la saisie renvoie le focus à la première
 *     case libre, pour que le code reste sans trou.
 */
import { useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";

const LONGUEUR = 6;

interface Props {
  valeur: string;
  onChange: (code: string) => void;
  /** Identifiant de la première case (celle qui reçoit le code proposé par Android). */
  id?: string;
  legende?: string;
  invalide?: boolean;
  describedBy?: string;
  disabled?: boolean;
}

export function SaisieCode({
  valeur,
  onChange,
  id = "code",
  legende = "Code reçu par SMS",
  invalide = false,
  describedBy,
  disabled,
}: Props) {
  const cases = useRef<Array<HTMLInputElement | null>>([]);
  const code = valeur.replace(/\D/g, "").slice(0, LONGUEUR);

  // Le focus ne bouge qu'après le rendu de la nouvelle valeur : avant, la case
  // suivante paraîtrait au-delà de la saisie et renverrait le focus en arrière.
  const focusApres = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (focusApres.current === null) return;
    cases.current[focusApres.current]?.focus();
    focusApres.current = null;
  });

  /** Focus sur la case `i` : après le rendu si la valeur change, tout de suite sinon. */
  function focus(i: number, apresRendu = true) {
    const cible = Math.max(0, Math.min(LONGUEUR - 1, i));
    if (apresRendu) focusApres.current = cible;
    else cases.current[cible]?.focus();
  }

  /** Place `chiffres` à partir de la case `i` ; un seul chiffre remplace celui de la case. */
  function placer(i: number, chiffres: string) {
    const suivant =
      chiffres.length === 1
        ? code.slice(0, i) + chiffres + code.slice(i + 1)
        : (code.slice(0, i) + chiffres).slice(0, LONGUEUR);
    onChange(suivant);
    focus(Math.min(i + chiffres.length, LONGUEUR - 1), suivant !== code);
  }

  function surSaisie(i: number, brut: string) {
    let chiffres = brut.replace(/\D/g, "");
    if (!chiffres) {
      // Case vidée (retour arrière, coupe) : le chiffre disparaît, la suite remonte.
      onChange(code.slice(0, i) + code.slice(i + 1));
      return;
    }
    // Un chiffre tapé à côté de l'ancien (sélection perdue) : on garde le nouveau.
    if (chiffres.length === 2 && code[i] && chiffres.includes(code[i])) {
      chiffres = chiffres.replace(code[i], "") || chiffres[1];
    }
    placer(i, chiffres);
  }

  function surTouche(i: number, e: KeyboardEvent<HTMLInputElement>) {
    // keyCode 8 : certains claviers Android ne renseignent pas `key`.
    const effacement = e.key === "Backspace" || e.keyCode === 8;
    if (effacement && !code[i] && i > 0) {
      e.preventDefault();
      onChange(code.slice(0, i - 1));
      focus(i - 1);
    } else if (/^\d$/.test(e.key) && e.key === code[i]) {
      // Même chiffre retapé : la valeur ne change pas, React ne voit aucune
      // saisie ; on avance quand même.
      e.preventDefault();
      focus(i + 1, false);
    } else if (e.key === "ArrowLeft" && i > 0) {
      e.preventDefault();
      focus(i - 1, false);
    } else if (e.key === "ArrowRight" && i < code.length) {
      e.preventDefault();
      focus(i + 1, false);
    }
  }

  function surCollage(i: number, e: ClipboardEvent<HTMLInputElement>) {
    const chiffres = e.clipboardData.getData("text").replace(/\D/g, "");
    e.preventDefault();
    if (chiffres) placer(i, chiffres.slice(0, LONGUEUR));
  }

  return (
    <fieldset className="m-0 p-0 border-0 min-w-0">
      <legend className="sr-only">{legende}</legend>
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: LONGUEUR }, (_, i) => {
          const rempli = Boolean(code[i]);
          return (
            <input
              key={i}
              ref={(el) => {
                cases.current[i] = el;
              }}
              id={i === 0 ? id : undefined}
              aria-label={`Chiffre ${i + 1} sur ${LONGUEUR}`}
              aria-invalid={invalide || undefined}
              aria-describedby={i === 0 ? describedBy : undefined}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              enterKeyHint={i === LONGUEUR - 1 ? "done" : "next"}
              disabled={disabled}
              value={code[i] ?? ""}
              onChange={(e) => surSaisie(i, e.target.value)}
              onKeyDown={(e) => surTouche(i, e)}
              onPaste={(e) => surCollage(i, e)}
              onFocus={(e) => {
                // Pas de trou : une case au-delà de la saisie renvoie à la première libre.
                if (i > code.length) cases.current[code.length]?.focus();
                else e.target.select();
              }}
              className="w-full h-[60px] rounded-[14px] text-center text-white font-extrabold outline-none disabled:opacity-60"
              style={{
                fontSize: 24,
                background: rempli ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.07)",
                border: invalide
                  ? "1.5px solid #F87171"
                  : `1.5px solid ${rempli ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.2)"}`,
              }}
            />
          );
        })}
      </div>
    </fieldset>
  );
}
