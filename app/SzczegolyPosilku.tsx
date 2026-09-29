"use client";

import type { PosilekWPlanie } from "@/lib/engine/planner";

/**
 * Pełna treść przepisu: składniki, półprodukty (ciasto), dodatki i kroki przygotowania.
 *
 * Wydzielone, bo potrzebują tego dwa widoki: „Mój plan" (gdzie user gotuje) i podgląd planu
 * przed akceptacją (gdzie decyduje, czy w ogóle chce to jeść). Wcześniej podgląd pokazywał samą
 * nazwę i makro — user widział „Pierogi fit z indyka, 660 kcal" i nie miał pojęcia, co w nich
 * jest ani ile z nimi roboty.
 */

interface Props {
  posilek: PosilekWPlanie;
  /** Ile razy zwielokrotnić gramatury (gotowanie dla kilku osób). */
  mnoznik: number;
  /** Kroki przygotowania bywają niepotrzebne w gęstym podglądzie całego tygodnia. */
  pokazInstrukcje?: boolean;
}

export default function SzczegolyPosilku({ posilek, mnoznik, pokazInstrukcje = true }: Props) {
  const ilosc = (x: number) => Math.round(x * mnoznik * 10) / 10;

  return (
    <>
      <p className="podtytul" style={{ marginTop: 10, marginBottom: 4 }}>
        Składniki{mnoznik > 1 ? ` (na ${mnoznik} osób)` : ""}:
      </p>
      <ul>
        {posilek.skladniki.map((s, i) => (
          <li key={i} className="posilek-makro">
            {s.nazwa} — {ilosc(s.ilosc)} {s.jednostka}
          </li>
        ))}
      </ul>

      {posilek.dodatki?.map((dodatek, i) => (
        <div key={i} style={{ marginTop: 10, paddingLeft: 12, borderLeft: "2px solid rgba(255,255,255,0.15)" }}>
          <div className="posilek-nazwa">+ {dodatek.nazwa}</div>
          <ul>
            {dodatek.skladniki.map((s, j) => (
              <li key={j} className="posilek-makro">
                {s.nazwa} — {ilosc(s.ilosc)} {s.jednostka}
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Ciasto trzeba zrobić PRZED daniem, więc idzie nad instrukcjami przepisu. */}
      {posilek.komponenty?.map((k, i) => (
        <div key={i} className="komponent-blok">
          <div className="posilek-nazwa">🥣 Najpierw: {k.nazwa}</div>
          <ul>
            {k.skladniki.map((s, j) => (
              <li key={j} className="posilek-makro">
                {s.nazwa} — {ilosc(s.ilosc)} {s.jednostka}
              </li>
            ))}
          </ul>
          {pokazInstrukcje && (
            <ol className="instrukcje">
              {k.instrukcje.map((krok, j) => (
                <li key={j} className="posilek-makro">
                  {krok}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}

      {/* Bez tego posiłek bez instrukcji kończył się po liście składników i nie było wiadomo,
          czy przepis się nie wczytał, czy go po prostu nie ma. Dotyczy zwłaszcza posiłków
          własnych: user składa je ze składników i nie musi nigdzie opisywać, co z nimi robi. */}
      {pokazInstrukcje && posilek.instrukcje.length === 0 && !posilek.komponenty?.length && (
        <p className="podtytul" style={{ marginTop: 14 }}>
          {posilek.wlasny
            ? "Ten posiłek złożyłeś sam i nie zapisałeś kroków przygotowania. Zbuduj go jeszcze raz, żeby dopisać przepis."
            : "Ten posiłek nie ma zapisanych kroków przygotowania."}
        </p>
      )}

      {pokazInstrukcje && posilek.instrukcje.length > 0 && (
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

      {pokazInstrukcje &&
        posilek.dodatki?.map((dodatek, i) => (
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
    </>
  );
}
