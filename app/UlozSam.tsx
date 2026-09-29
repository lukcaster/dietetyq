"use client";

import { useState } from "react";
import KreatorPosilku from "./KreatorPosilku";
import WybierzPrzepis from "./WybierzPrzepis";
import { zbudujListeZakupow } from "@/lib/engine/lista-zakupow";
import type { DzienWPlanie, PosilekWPlanie, WygenerowanyPlan } from "@/lib/engine/planner";
import type { Makro } from "@/lib/engine/types";
import { SLOTY_DLA_LICZBY, type Profil } from "@/lib/magazyn";

/**
 * „Ułożę plan sam" — user wypełnia każdy slot ręcznie, zamiast dostać gotowy plan z silnika.
 *
 * Trzy drogi na każdy posiłek: wybór przepisu z bazy, złożenie własnego ze składników
 * (ten sam kreator co dawniej pod „Zbuduj sam") albo „dobierz za mnie", czyli jedno kliknięcie
 * dla slotów, na których userowi nie zależy. Ta trzecia opcja jest tu z praktycznego powodu:
 * ręczne ułożenie tygodnia to 35 decyzji i bez niej nikt by tego nie skończył.
 *
 * Makro liczymy na bieżąco i mówimy wprost, gdy dzień się rozjeżdża — ale **nie blokujemy
 * zapisu**. To user układa ten plan i on decyduje; apka ma ostrzegać, nie zabraniać.
 */

const NAZWY_SLOTOW: Record<string, string> = {
  sniadanie: "🌅 Śniadanie",
  "drugie-sniadanie": "🥪 II śniadanie",
  obiad: "🍽️ Obiad",
  podwieczorek: "🍓 Podwieczorek",
  kolacja: "🌙 Kolacja",
};

/** Powyżej tego rozjazdu od celu dnia mówimy o tym wprost — ten sam próg co w trybie z lodówki. */
const PROG_OSTRZEZENIA = 20;

/**
 * Od takiego niedoboru białka proponujemy domknięcie dnia. Kopia PROG_NIEDOBORU_G z
 * domykanie.ts — nie da się go zaimportować, bo tamten moduł czyta bazę składników przez `fs`
 * i wciągnięcie go tutaj wysadziłoby build komponentu klienckiego (patrz cele.ts).
 * Silnik i tak ma ostatnie słowo: gdy uzna, że nie ma czego dołożyć, powie to wprost.
 */
const PROG_DOMKNIECIA_G = 15;

function pusteMakro(): Makro {
  return { kcal: 0, bialko: 0, tluszcz: 0, wegle: 0 };
}

function sumujMakro(posilki: (PosilekWPlanie | null)[]): Makro {
  return posilki.reduce<Makro>((suma, p) => {
    if (!p) return suma;
    return {
      kcal: suma.kcal + p.makro.kcal,
      bialko: suma.bialko + p.makro.bialko,
      tluszcz: suma.tluszcz + p.makro.tluszcz,
      wegle: suma.wegle + p.makro.wegle,
    };
  }, pusteMakro());
}

interface Props {
  profil: Profil;
  liczbaDni: number;
  celeSlotow: Record<string, Makro>;
  kcalDzienne: number;
  makroDzienne: Makro;
  /** Wspólne dane do zapytań (kcal, makro, restrykcje, preferencje). */
  daneZapytania: Record<string, unknown>;
  onZapisz: (plan: WygenerowanyPlan) => void;
  onAnuluj: () => void;
}

type Wybor = { dzien: number; indeks: number; slot: string; tryb: "przepis" | "kreator" };

export default function UlozSam({
  profil,
  liczbaDni,
  celeSlotow,
  kcalDzienne,
  makroDzienne,
  daneZapytania,
  onZapisz,
  onAnuluj,
}: Props) {
  const sloty = SLOTY_DLA_LICZBY[profil.liczbaPosilkow];
  const [posilki, setPosilki] = useState<(PosilekWPlanie | null)[][]>(
    Array.from({ length: liczbaDni }, () => sloty.map(() => null))
  );
  const [wybor, setWybor] = useState<Wybor | null>(null);
  const [pracuje, setPracuje] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  /** Indeks dnia → co silnik odpowiedział na „domknij" (np. że nie ma czego dołożyć). */
  const [komunikaty, setKomunikaty] = useState<Record<number, string>>({});

  const mnoznik = profil.liczbaOsob;
  const wypelnionych = posilki.flat().filter(Boolean).length;
  const wszystkich = liczbaDni * sloty.length;

  function ustaw(dzien: number, indeks: number, posilek: PosilekWPlanie | null) {
    setPosilki((stan) => stan.map((d, i) => (i === dzien ? d.map((p, j) => (j === indeks ? posilek : p)) : d)));
  }

  async function wezZPrzepisu(dzien: number, indeks: number, slot: string, recipeId: string) {
    setPracuje(true);
    setBlad(null);
    try {
      const odpowiedz = await fetch("/api/posilek/z-przepisu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...daneZapytania, slot, recipeId }),
      });
      const wynik = await odpowiedz.json();
      if (!odpowiedz.ok) throw new Error(wynik.blad ?? "Nie udało się dodać przepisu");
      ustaw(dzien, indeks, wynik);
      setWybor(null);
    } catch (e) {
      setBlad(e instanceof Error ? e.message : "Nieznany błąd");
    } finally {
      setPracuje(false);
    }
  }

  /** „Dobierz za mnie" — ten sam mechanizm, co wymiana posiłku w gotowym planie. */
  async function dobierz(dzien: number, indeks: number, slot: string) {
    setPracuje(true);
    setBlad(null);
    try {
      const odpowiedz = await fetch("/api/plan/wymien", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...daneZapytania, slot }),
      });
      const wynik = await odpowiedz.json();
      if (!odpowiedz.ok) throw new Error(wynik.blad ?? "Nie udało się nic dobrać");
      ustaw(dzien, indeks, wynik.propozycje[0]);
    } catch (e) {
      setBlad(e instanceof Error ? e.message : "Nieznany błąd");
    } finally {
      setPracuje(false);
    }
  }

  /**
   * „Domknij białko" — to samo, co silnik robi po cichu przy generowaniu planu: dokłada do
   * gotowych już posiłków zwykłe jedzenie. Nie rusza samych dań: user je wybrał i zmiana
   * gramatur pod tabelkę byłaby przestawianiem mu planu za plecami.
   */
  async function domknij(indeksDnia: number) {
    const dzien = posilki[indeksDnia];
    const doWyslania = dzien.filter((p): p is PosilekWPlanie => p !== null);
    setPracuje(true);
    setBlad(null);
    setKomunikaty((k) => ({ ...k, [indeksDnia]: "" }));
    try {
      const odpowiedz = await fetch("/api/dzien/domknij", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          posilki: doWyslania,
          celDnia: makroDzienne,
          restrykcje: profil.restrykcje,
          nielubiane: profil.nielubianeSkladniki,
        }),
      });
      const wynik = await odpowiedz.json();
      if (!odpowiedz.ok) throw new Error(wynik.blad ?? "Nie udało się domknąć dnia");
      // Komunikat przychodzi też przy domknięciu częściowym — wtedy jednocześnie wstawiamy
      // posiłki i mówimy, dlaczego to nie wszystko.
      if (wynik.komunikat) setKomunikaty((k) => ({ ...k, [indeksDnia]: wynik.komunikat }));
      if (!wynik.dodaneBialko) return;

      // Silnik zachowuje kolejność, ale dostał dzień bez pustych slotów — wstawiamy z powrotem
      // po kolei, pomijając luki.
      const zwrocone: PosilekWPlanie[] = wynik.posilki;
      let kolejny = 0;
      setPosilki((stan) =>
        stan.map((d, i) => (i === indeksDnia ? d.map((p) => (p === null ? null : zwrocone[kolejny++])) : d))
      );
    } catch (e) {
      setBlad(e instanceof Error ? e.message : "Nieznany błąd");
    } finally {
      setPracuje(false);
    }
  }

  function zapisz() {
    const dni: DzienWPlanie[] = posilki.map((dzien, i) => {
      const gotowe = dzien.filter((p): p is PosilekWPlanie => p !== null);
      return { dzien: i + 1, posilki: gotowe, makroDnia: sumujMakro(gotowe) };
    });
    onZapisz({
      kcalDzienne,
      makroDzienne,
      celeSlotow,
      dni,
      listaZakupow: zbudujListeZakupow(dni),
      ostrzezenia: [],
    });
  }

  /** Rozjazd dnia od celu — pokazujemy tylko dla dni, które user już zaczął wypełniać. */
  function opiszRozjazd(makro: Makro): string | null {
    const nazwy: [keyof Makro, string][] = [
      ["kcal", "kalorii"],
      ["bialko", "białka"],
      ["tluszcz", "tłuszczu"],
      ["wegle", "węglowodanów"],
    ];
    const istotne = nazwy
      .map(([klucz, nazwa]) => {
        const cel = makroDzienne[klucz];
        return { nazwa, procent: cel > 0 ? ((makro[klucz] - cel) / cel) * 100 : 0 };
      })
      .filter(({ procent }) => Math.abs(procent) > PROG_OSTRZEZENIA)
      .sort((a, b) => Math.abs(b.procent) - Math.abs(a.procent));
    if (istotne.length === 0) return null;
    return istotne
      .map(({ nazwa, procent }) =>
        procent < 0 ? `brakuje ${Math.round(-procent)}% ${nazwa}` : `o ${Math.round(procent)}% za dużo ${nazwa}`
      )
      .join(", ");
  }

  return (
    <>
      <h2>Układasz plan sam</h2>
      <p className="podtytul" style={{ marginBottom: 8 }}>
        Wypełnione {wypelnionych} z {wszystkich} posiłków. Przy każdym możesz wybrać przepis z bazy, złożyć
        własny ze składników albo pozwolić nam dobrać.
      </p>

      {blad && <div className="blad">{blad}</div>}

      {posilki.map((dzien, indeksDnia) => {
        const makroDnia = sumujMakro(dzien);
        const zaczety = dzien.some(Boolean);
        const kompletny = dzien.every(Boolean);
        const rozjazd = kompletny ? opiszRozjazd(makroDnia) : null;
        const brakujeBialka = makroDzienne.bialko - makroDnia.bialko;
        return (
          <div key={indeksDnia} className="dzien-karta">
            <div className="dzien-naglowek">
              <h3>{liczbaDni === 1 ? "Twój dzień" : `Dzień ${indeksDnia + 1}`}</h3>
              {zaczety && (
                <span className="podtytul">
                  {Math.round(makroDnia.kcal)} / {Math.round(kcalDzienne)} kcal
                </span>
              )}
            </div>

            {sloty.map((slot, indeks) => {
              const posilek = dzien[indeks];
              const cel = celeSlotow[slot];
              return (
                <div key={slot} className="posilek">
                  <div className="posilek-nazwa">
                    {NAZWY_SLOTOW[slot] ?? slot}
                    {posilek && <span className="podtytul"> — {posilek.nazwa}</span>}
                  </div>
                  {posilek ? (
                    <div className="posilek-makro">
                      {Math.round(posilek.makro.kcal)} kcal · B: {Math.round(posilek.makro.bialko)}g · T:{" "}
                      {Math.round(posilek.makro.tluszcz)}g · W: {Math.round(posilek.makro.wegle)}g
                      {cel && ` (cel ${Math.round(cel.kcal)} kcal)`}
                      {posilek.dosypki?.map((d, i) => (
                        <div key={i} className="dosypka">
                          ➕ Do tego: <strong>{d.opis}</strong>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="posilek-makro">
                      pusty · cel {cel ? Math.round(cel.kcal) : "?"} kcal
                    </div>
                  )}

                  <div className="posilek-akcje">
                    <button
                      className="btn-maly"
                      disabled={pracuje}
                      onClick={() => setWybor({ dzien: indeksDnia, indeks, slot, tryb: "przepis" })}
                    >
                      📖 {posilek ? "Zmień przepis" : "Wybierz przepis"}
                    </button>
                    <button
                      className="btn-maly"
                      disabled={pracuje}
                      onClick={() => setWybor({ dzien: indeksDnia, indeks, slot, tryb: "kreator" })}
                    >
                      🧩 Zbuduj sam
                    </button>
                    <button className="btn-maly" disabled={pracuje} onClick={() => dobierz(indeksDnia, indeks, slot)}>
                      🎲 Dobierz za mnie
                    </button>
                    {posilek && (
                      <button className="btn-maly" onClick={() => ustaw(indeksDnia, indeks, null)}>
                        ✕ Wyczyść
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {zaczety && (
              <div className="posilek-makro" style={{ marginTop: 8 }}>
                Razem: B {Math.round(makroDnia.bialko)} / {Math.round(makroDzienne.bialko)}g · T{" "}
                {Math.round(makroDnia.tluszcz)} / {Math.round(makroDzienne.tluszcz)}g · W{" "}
                {Math.round(makroDnia.wegle)} / {Math.round(makroDzienne.wegle)}g
              </div>
            )}
            {rozjazd && (
              <div className="kreator-ostrzezenie">
                ⚠ Dzień {indeksDnia + 1}: {rozjazd}. Możesz to zostawić — to Twój plan — ale sprawdź, czy
                na pewno o to Ci chodziło.
                {brakujeBialka >= PROG_DOMKNIECIA_G && (
                  <div style={{ marginTop: 10 }}>
                    <button className="btn-maly" disabled={pracuje} onClick={() => domknij(indeksDnia)}>
                      {pracuje ? "Liczę..." : "🍳 Domknij białko"}
                    </button>
                    <span className="podtytul" style={{ marginLeft: 8 }}>
                      Dołożymy do posiłków zwykłe jedzenie — plaster szynki, jajko, trochę więcej mięsa.
                      Dania zostają takie, jakie wybrałeś.
                    </span>
                  </div>
                )}
              </div>
            )}
            {komunikaty[indeksDnia] && <div className="posilek-makro">{komunikaty[indeksDnia]}</div>}
          </div>
        );
      })}

      {wybor?.tryb === "przepis" && (
        <WybierzPrzepis
          slot={wybor.slot}
          cel={celeSlotow[wybor.slot]}
          restrykcje={profil.restrykcje}
          nielubiane={profil.nielubianeSkladniki}
          pracuje={pracuje}
          onWybierz={(recipeId) => wezZPrzepisu(wybor.dzien, wybor.indeks, wybor.slot, recipeId)}
          onAnuluj={() => setWybor(null)}
        />
      )}

      {wybor?.tryb === "kreator" && (
        <div className="modal-tlo" onClick={() => setWybor(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <KreatorPosilku
              slot={wybor.slot}
              cel={celeSlotow[wybor.slot]}
              restrykcje={profil.restrykcje}
              onZapisz={(posilek) => {
                ustaw(wybor.dzien, wybor.indeks, posilek);
                setWybor(null);
              }}
              onAnuluj={() => setWybor(null)}
            />
          </div>
        </div>
      )}

      <div className="przyciski-nawigacji">
        <button className="btn btn-wstecz" onClick={onAnuluj}>
          Anuluj
        </button>
        <button className="btn btn-dalej" disabled={wypelnionych === 0 || pracuje} onClick={zapisz}>
          {wypelnionych < wszystkich ? `Zapisz (${wypelnionych}/${wszystkich})` : "✓ Zapisz plan"}
        </button>
      </div>
    </>
  );
}
