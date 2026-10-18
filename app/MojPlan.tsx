"use client";

import { useState } from "react";
import SzczegolyPosilku from "./SzczegolyPosilku";
import type { DzienWPlanie, PosilekWPlanie, WygenerowanyPlan } from "@/lib/engine/planner";
import type { Makro } from "@/lib/engine/types";
import { NAZWY_SLOTOW, type Profil } from "@/lib/magazyn";

/**
 * „Mój plan" — cały dzień na jednym ekranie, rozwinięty ten posiłek, który jest teraz.
 *
 * Poprzednia wersja pokazywała dokładnie jeden posiłek i żeby zobaczyć następny, trzeba było
 * kliknąć „Zjadłem". Jedzenie stawało się bramką do reszty planu: user, który chciał tylko
 * sprawdzić, co jest na kolację, musiał skłamać aplikacji. Teraz wszystkie posiłki dnia są
 * wierszami, każdy da się otworzyć, a „Zjadłem" robi wyłącznie to, co mówi.
 *
 * Wybrany został układ „lista dnia" z trzech zaproponowanych makiet — bo jako jedyny skaluje
 * się wprost na plan siedmiodniowy i działa na telefonie bez osobnego wariantu.
 */

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

/** Od takiego niedoboru białka proponujemy domknięcie — ten sam próg co w UlozSam. */
const PROG_DOMKNIECIA_G = 15;

function sumujMakro(posilki: PosilekWPlanie[]): Makro {
  return posilki.reduce(
    (suma, p) => ({
      kcal: suma.kcal + p.makro.kcal,
      bialko: suma.bialko + p.makro.bialko,
      tluszcz: suma.tluszcz + p.makro.tluszcz,
      wegle: suma.wegle + p.makro.wegle,
    }),
    { kcal: 0, bialko: 0, tluszcz: 0, wegle: 0 }
  );
}

interface Props {
  plan: WygenerowanyPlan;
  profil: Profil;
  zjedzone: string[];
  onZjedzone: (klucz: string) => void;
  onCofnij: (klucz: string) => void;
  onWymien: (dzien: number, indeks: number) => void;
  /** Przestawienie gniazda przepisu (inne ciasto, inne nadzienie) — patrz WyborWPosilku. */
  onZmienWybor: (dzien: number, indeks: number, nazwaGrupy: string, komponentId: string) => void;
  onDomknij: (indeksDnia: number) => void;
  onPokazCalyPlan: () => void;
  onListaZakupow: () => void;
  onMenu: () => void;
  pracuje?: boolean;
  /** Co silnik odpowiedział na „domknij białko" — np. że nie ma czego dołożyć. */
  komunikatDomkniecia?: string | null;
}

export default function MojPlan({
  plan,
  profil,
  zjedzone,
  onZjedzone,
  onCofnij,
  onWymien,
  onZmienWybor,
  onDomknij,
  onPokazCalyPlan,
  onListaZakupow,
  onMenu,
  pracuje,
  komunikatDomkniecia,
}: Props) {
  const biezacy = znajdzBiezacy(plan, zjedzone);
  const wszystkich = plan.dni.reduce((s, d) => s + d.posilki.length, 0);
  /** null = podążaj za bieżącym posiłkiem; liczba = user sam wybrał wiersz. */
  const [recznieOtwarty, setRecznieOtwarty] = useState<number | null>(null);

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

  const { dzien, indeks: indeksBiezacego } = biezacy;
  const odhaczone = new Set(zjedzone);
  const mnoznik = profil.liczbaOsob;
  const otwarty = recznieOtwarty ?? indeksBiezacego;

  const makroDnia = sumujMakro(dzien.posilki);
  const celDnia = plan.makroDzienne;
  const procentKcal = celDnia.kcal > 0 ? Math.min(100, Math.round((makroDnia.kcal / celDnia.kcal) * 100)) : 0;
  const brakujeBialka = celDnia.bialko - makroDnia.bialko;

  const indeksDnia = plan.dni.findIndex((d) => d.dzien === dzien.dzien);

  return (
    <>
      <h2>
        {plan.dni.length > 1 ? `Dzień ${dzien.dzien}` : "Twój dzień"}
        <span className="podtytul"> · zjedzone {zjedzone.length} z {wszystkich}</span>
      </h2>

      <div className="dzien-podsumowanie">
        <div className="dzien-liczby">
          <span>
            <b>{Math.round(makroDnia.kcal)}</b> / {Math.round(celDnia.kcal)} kcal
          </span>
          <span className="podtytul">
            B {Math.round(makroDnia.bialko)}/{Math.round(celDnia.bialko)}g · T {Math.round(makroDnia.tluszcz)}/
            {Math.round(celDnia.tluszcz)}g · W {Math.round(makroDnia.wegle)}/{Math.round(celDnia.wegle)}g
          </span>
        </div>
        <div className="dzien-tor">
          <i style={{ width: `${procentKcal}%` }} />
        </div>
      </div>

      <div className="lista-dnia">
        {dzien.posilki.map((posilek, i) => {
          const klucz = kluczPosilku(dzien.dzien, i);
          const zjedzony = odhaczone.has(klucz);
          const rozwiniety = otwarty === i;
          return (
            <div key={klucz} className={`posilek-wiersz ${rozwiniety ? "otwarty" : ""} ${zjedzony ? "zjedzony" : ""}`}>
              <button
                className="wiersz-glowa"
                aria-expanded={rozwiniety}
                onClick={() => setRecznieOtwarty(rozwiniety ? -1 : i)}
              >
                <span className="wiersz-opis">
                  <span className="wiersz-slot">
                    {NAZWY_SLOTOW[posilek.slot] ?? posilek.slot}
                    {i === indeksBiezacego && !zjedzony && " · teraz"}
                  </span>
                  <span className="wiersz-nazwa">{posilek.nazwa}</span>
                </span>
                <span className="wiersz-kcal">{Math.round(posilek.makro.kcal)} kcal</span>
                <span className="wiersz-ptaszek">{zjedzony ? "✓" : ""}</span>
              </button>

              {rozwiniety && (
                <div className="wiersz-tresc">
                  <div className="posilek-makro">
                    B: {Math.round(posilek.makro.bialko)}g · T: {Math.round(posilek.makro.tluszcz)}g · W:{" "}
                    {Math.round(posilek.makro.wegle)}g
                    {posilek.czasPrzygotowania ? ` · ${posilek.czasPrzygotowania} min` : ""}
                    {posilek.gotowiec && (
                      <span className="znacznik znacznik-baza">
                        {posilek.bezGotowania ? "bez gotowania" : "składane"}
                      </span>
                    )}
                  </div>

                  {posilek.uwaga && <span className="uwaga">⚠ {posilek.uwaga}</span>}
                  {posilek.dosypki?.map((d, j) => (
                    <div key={j} className="dosypka">
                      ➕ Do tego: <strong>{d.opis}</strong>
                    </div>
                  ))}

                  <SzczegolyPosilku
                    posilek={posilek}
                    mnoznik={mnoznik}
                    pracuje={pracuje}
                    onZmienWybor={(grupa, komponentId) => onZmienWybor(indeksDnia, i, grupa, komponentId)}
                  />

                  <div className="posilek-akcje" style={{ marginTop: 16 }}>
                    {zjedzony ? (
                      <button className="btn-maly" onClick={() => onCofnij(klucz)}>
                        ↩ Cofnij zjedzone
                      </button>
                    ) : (
                      <button
                        className="btn-maly btn-zjedz"
                        onClick={() => {
                          onZjedzone(klucz);
                          // Wracamy do podążania za bieżącym, żeby otworzył się następny posiłek.
                          setRecznieOtwarty(null);
                        }}
                      >
                        ✓ Zjadłem
                      </button>
                    )}
                    <button className="btn-maly" disabled={pracuje} onClick={() => onWymien(indeksDnia, i)}>
                      🔄 Wymień
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {brakujeBialka >= PROG_DOMKNIECIA_G && (
        <div className="kreator-ostrzezenie" style={{ marginTop: 16 }}>
          ⚠ Dziś brakuje {Math.round(brakujeBialka)} g białka.
          <div style={{ marginTop: 10 }}>
            <button className="btn-maly" disabled={pracuje} onClick={() => onDomknij(indeksDnia)}>
              {pracuje ? "Liczę..." : "🍳 Domknij białko"}
            </button>
            <span className="podtytul" style={{ marginLeft: 8 }}>
              Dołożymy do posiłków zwykłe jedzenie — dania zostają te same.
            </span>
          </div>
        </div>
      )}

      {komunikatDomkniecia && <div className="posilek-makro">{komunikatDomkniecia}</div>}

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
    </>
  );
}
