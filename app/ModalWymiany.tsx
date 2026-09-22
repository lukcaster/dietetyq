"use client";

import type { PosilekWPlanie } from "@/lib/engine/planner";

/**
 * Wybór zamiennika posiłku spośród kilku propozycji.
 *
 * Wcześniej wymiana losowała jedno danie i podmieniała je od razu — user nie wiedział, co
 * dostanie, i klikał w kółko, aż trafił na coś znośnego. Teraz silnik proponuje trzy, a user
 * wybiera. Każda propozycja trafia w ten sam cel kcal, więc makro dnia zostaje.
 */

interface Props {
  slot: string;
  propozycje: PosilekWPlanie[];
  liczbaOsob: number;
  onWybierz: (posilek: PosilekWPlanie) => void;
  onAnuluj: () => void;
  pracuje?: boolean;
  onLosujPonownie: () => void;
}

export default function ModalWymiany({
  propozycje,
  liczbaOsob,
  onWybierz,
  onAnuluj,
  pracuje,
  onLosujPonownie,
}: Props) {
  return (
    <div className="modal-tlo" onClick={onAnuluj}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Na co wymienić?</h2>
        <p className="podtytul" style={{ marginBottom: 16 }}>
          Każda propozycja trafia w ten sam cel kalorii, więc dzień się nie rozjedzie.
        </p>

        {propozycje.map((p) => (
          <button key={p.recipeId} className="propozycja-wymiany" onClick={() => onWybierz(p)}>
            <span className="posilek-nazwa">
              {p.nazwa}
              {p.gotowiec && (
                <span className="znacznik znacznik-baza">{p.bezGotowania ? "bez gotowania" : "składane"}</span>
              )}
            </span>
            <span className="posilek-makro">
              {Math.round(p.makro.kcal)} kcal · B: {Math.round(p.makro.bialko)}g · T: {Math.round(p.makro.tluszcz)}g ·
              W: {Math.round(p.makro.wegle)}g
              {p.czasPrzygotowania ? ` · ${p.czasPrzygotowania} min` : ""}
            </span>
            <span className="posilek-makro">
              {p.skladniki
                .slice(0, 5)
                .map((s) => `${s.nazwa} ${Math.round(s.ilosc * liczbaOsob)}${s.jednostka}`)
                .join(", ")}
              {p.skladniki.length > 5 ? "…" : ""}
            </span>
          </button>
        ))}

        <div className="menu-akcje">
          <button className="btn-maly" disabled={pracuje} onClick={onLosujPonownie}>
            {pracuje ? "Szukam..." : "🔄 Pokaż inne"}
          </button>
          <button className="btn-maly" onClick={onAnuluj}>
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
