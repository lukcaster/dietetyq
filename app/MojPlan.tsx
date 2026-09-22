"use client";

import { useState } from "react";
import type { DzienWPlanie, PosilekWPlanie, WygenerowanyPlan } from "@/lib/engine/planner";
import type { Profil } from "@/lib/magazyn";

/**
 * „Mój plan" — widok dnia codziennego, nie kreatora.
 *
 * Domyślnie pokazuje **jeden posiłek: pierwszy niezjedzony**. To jest cała różnica względem
 * poprzedniej wersji, która wyrzucała userowi siedem dni naraz i kazała szukać, co ma teraz
 * zjeść. Reszta (cały plan, lista zakupów) jest o jedno kliknięcie dalej.
 */

const NAZWY_SLOTOW: Record<string, string> = {
  sniadanie: "🌅 Śniadanie",
  "drugie-sniadanie": "🥪 II śniadanie",
  obiad: "🍽️ Obiad",
  podwieczorek: "🍓 Podwieczorek",
  kolacja: "🌙 Kolacja",
};

export function kluczPosilku(dzien: number, indeks: number): string {
  return `${dzien}:${indeks}`;
}

/** Pierwszy posiłek, którego user jeszcze nie odhaczył. Null = plan zjedzony do końca. */
export function znajdzBiezacy(
  plan: WygenerowanyPlan,
  zjedzone: string[]
): { dzien: DzienWPlanie; posilek: PosilekWPlanie; indeks: number } | null {
  const odhaczone = new Set(zjedzone);
  for (const dzien of plan.dni) {
    for (let i = 0; i < dzien.posilki.length; i++) {
      if (!odhaczone.has(kluczPosilku(dzien.dzien, i))) {
        return { dzien, posilek: dzien.posilki[i], indeks: i };
      }
    }
  }
  return null;
}

interface Props {
  plan: WygenerowanyPlan;
  profil: Profil;
  zjedzone: string[];
  onZjedzone: (klucz: string) => void;
  onCofnij: (klucz: string) => void;
  onWymien: (dzien: number, indeks: number) => void;
  onPokazCalyPlan: () => void;
  onListaZakupow: () => void;
  onMenu: () => void;
  pracuje?: boolean;
}

export default function MojPlan({
  plan,
  profil,
  zjedzone,
  onZjedzone,
  onCofnij,
  onWymien,
  onPokazCalyPlan,
  onListaZakupow,
  onMenu,
  pracuje,
}: Props) {
  const biezacy = znajdzBiezacy(plan, zjedzone);
  const wszystkich = plan.dni.reduce((s, d) => s + d.posilki.length, 0);
  const [pokazSklad, setPokazSklad] = useState(true);

  if (!biezacy) {
    return (
      <>
        <h2>Plan zjedzony w całości 🎉</h2>
        <p className="podtytul">
          {wszystkich} {wszystkich === 1 ? "posiłek" : "posiłków"} odhaczonych. Możesz wygenerować nowy plan
          albo cofnąć ostatni posiłek, jeśli odhaczyłeś go przez pomyłkę.
        </p>
        <div className="przyciski-nawigacji">
          <button className="btn btn-wstecz" onClick={() => onCofnij(zjedzone[zjedzone.length - 1])}>
            Cofnij ostatni
          </button>
          <button className="btn btn-dalej" onClick={onMenu}>
            Menu
          </button>
        </div>
      </>
    );
  }

  const { dzien, posilek, indeks } = biezacy;
  const klucz = kluczPosilku(dzien.dzien, indeks);
  const mnoznik = profil.liczbaOsob;

  return (
    <>
      <h2>
        {NAZWY_SLOTOW[posilek.slot] ?? posilek.slot}
        {plan.dni.length > 1 && <span className="podtytul"> · dzień {dzien.dzien}</span>}
      </h2>
      <p className="podtytul" style={{ marginBottom: 12 }}>
        Zjedzone {zjedzone.length} z {wszystkich} posiłków planu
      </p>

      <div className="dzien-karta">
        <div className="posilek">
          <div className="posilek-nazwa">
            {posilek.nazwa}
            {posilek.gotowiec && (
              <span className="znacznik znacznik-baza">{posilek.bezGotowania ? "bez gotowania" : "składane"}</span>
            )}
            {posilek.czasPrzygotowania && <span className="podtytul"> · {posilek.czasPrzygotowania} min</span>}
          </div>
          <div className="posilek-makro">
            {Math.round(posilek.makro.kcal)} kcal · B: {Math.round(posilek.makro.bialko)}g · T:{" "}
            {Math.round(posilek.makro.tluszcz)}g · W: {Math.round(posilek.makro.wegle)}g
          </div>
          {posilek.uwaga && <span className="uwaga">⚠ {posilek.uwaga}</span>}
          {posilek.dosypki?.map((d, i) => (
            <div key={i} className="dosypka">
              ➕ Do tego: <strong>{d.opis}</strong>
            </div>
          ))}

          <button className="btn-maly" style={{ marginTop: 12 }} onClick={() => setPokazSklad((p) => !p)}>
            {pokazSklad ? "Ukryj składniki" : "Pokaż składniki"}
          </button>

          {pokazSklad && (
            <>
              <p className="podtytul" style={{ marginTop: 10, marginBottom: 4 }}>
                Składniki{mnoznik > 1 ? ` (na ${mnoznik} osób)` : ""}:
              </p>
              <ul>
                {posilek.skladniki.map((s, i) => (
                  <li key={i} className="posilek-makro">
                    {s.nazwa} — {Math.round(s.ilosc * mnoznik * 10) / 10} {s.jednostka}
                  </li>
                ))}
              </ul>
              {posilek.dodatki?.map((dodatek, i) => (
                <div key={i} style={{ marginTop: 10, paddingLeft: 12, borderLeft: "2px solid rgba(255,255,255,0.15)" }}>
                  <div className="posilek-nazwa">+ {dodatek.nazwa}</div>
                  <ul>
                    {dodatek.skladniki.map((s, j) => (
                      <li key={j} className="posilek-makro">
                        {s.nazwa} — {Math.round(s.ilosc * mnoznik * 10) / 10} {s.jednostka}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}

          {posilek.instrukcje.length > 0 && (
            <>
              <p className="podtytul" style={{ marginTop: 14, marginBottom: 4 }}>
                Jak to zrobić:
              </p>
              <ol className="instrukcje">
                {posilek.instrukcje.map((krok, i) => (
                  <li key={i} className="posilek-makro">
                    {krok}
                  </li>
                ))}
              </ol>
            </>
          )}

          {posilek.dodatki?.map((dodatek, i) => (
            <div key={i}>
              <p className="podtytul" style={{ marginTop: 10, marginBottom: 4 }}>
                {dodatek.nazwa}:
              </p>
              <ol className="instrukcje">
                {dodatek.instrukcje.map((krok, j) => (
                  <li key={j} className="posilek-makro">
                    {krok}
                  </li>
                ))}
              </ol>
            </div>
          ))}

          <div className="posilek-akcje" style={{ marginTop: 16 }}>
            <button className="btn-maly" disabled={pracuje} onClick={() => onWymien(dzien.dzien - 1, indeks)}>
              🔄 Wymień
            </button>
            {zjedzone.length > 0 && (
              <button className="btn-maly" onClick={() => onCofnij(zjedzone[zjedzone.length - 1])}>
                ↩ Cofnij poprzedni
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="menu-akcje">
        <button className="btn-maly" onClick={onPokazCalyPlan}>
          📋 Cały plan
        </button>
        <button className="btn-maly" onClick={onListaZakupow}>
          🛒 Lista zakupów
        </button>
        <button className="btn-maly" onClick={onMenu}>
          ← Menu
        </button>
      </div>

      <div className="przyciski-nawigacji">
        <button className="btn btn-dalej" onClick={() => onZjedzone(klucz)}>
          ✓ Zjadłem
        </button>
      </div>
    </>
  );
}
