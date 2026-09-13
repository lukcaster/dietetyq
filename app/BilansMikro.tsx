"use client";

import { useEffect, useState } from "react";
import type { SkladnikBazowyWPlanie } from "@/lib/engine/lista-zakupow";
import type { BilansMikro as Bilans, Plec, PozycjaBilansu } from "@/lib/engine/mikro";

/**
 * Bilans mikroskładników — ten sam komponent dla planu z przepisów (7 dni) i trybu
 * "z lodówki" (1 dzień). Przy wielu dniach pokazuje średnią i w ilu dniach jest niedobór,
 * bo "średnio 90% żelaza" ukrywa fakt, że w czterech dniach było go o połowę za mało.
 *
 * Liczenie idzie przez API, bo wymaga dostępu do `ingredients.json` (mikro na 100 g),
 * a ten plik świadomie zostaje na serwerze.
 */

/** Poniżej tego pokrycia danych nie pokazujemy liczb, tylko mówimy, że nie ma z czego liczyć. */
const PROG_WIARYGODNOSCI = 0.6;

interface Props {
  dni: SkladnikBazowyWPlanie[][];
  plec?: Plec;
}

function pasekStanu(pozycja: PozycjaBilansu): "ok" | "blisko" | "daleko" {
  if (pozycja.stan === "ok") return "ok";
  return pozycja.procent < 50 || pozycja.procent > 130 ? "daleko" : "blisko";
}

export default function BilansMikro({ dni, plec = "M" }: Props) {
  const [bilanse, setBilanse] = useState<Bilans[] | null>(null);
  const [blad, setBlad] = useState<string | null>(null);

  // Klucz z zawartości, żeby przeliczyć po podmianie posiłku albo korekcie gramatur.
  const klucz = JSON.stringify(dni.map((d) => d.map((s) => [s.skladnikId, s.ilosc, s.jednostka])));

  useEffect(() => {
    let aktualne = true;
    setBlad(null);
    fetch("/api/bilans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dni, plec }),
    })
      .then((o) => o.json())
      .then((wynik) => {
        if (!aktualne) return;
        if (wynik.blad) setBlad(wynik.blad);
        else setBilanse(wynik.bilanse);
      })
      .catch(() => aktualne && setBlad("Nie udało się policzyć bilansu"));
    return () => {
      aktualne = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [klucz, plec]);

  if (blad) return <div className="blad">{blad}</div>;
  if (!bilanse || bilanse.length === 0) return <p className="podtytul">Liczę bilans...</p>;

  const pokrycie = bilanse.reduce((s, b) => s + b.pokrycieMasy, 0) / bilanse.length;

  if (pokrycie < PROG_WIARYGODNOSCI) {
    const nieznane = [...new Set(bilanse.flatMap((b) => b.niepoliczone))];
    return (
      <div className="kreator-ostrzezenie">
        ⚠ Nie ma z czego policzyć bilansu — dane o mikroskładnikach pokrywają tylko{" "}
        {Math.round(pokrycie * 100)}% masy jedzenia. Brakuje ich dla: {nieznane.join(", ")}.
      </div>
    );
  }

  // Pozycje w tej samej kolejności w każdym dniu (pochodzą z OPISY_MIKRO), więc mapujemy po indeksie.
  const wiersze = bilanse[0].pozycje.map((wzorzec, i) => {
    const wszystkie = bilanse.map((b) => b.pozycje[i]);
    const sredniProcent = Math.round(wszystkie.reduce((s, p) => s + p.procent, 0) / wszystkie.length);
    const srednioIle = wszystkie.reduce((s, p) => s + p.ile, 0) / wszystkie.length;
    const zleDni = wszystkie.filter((p) => p.stan !== "ok").length;
    return { wzorzec, sredniProcent, srednioIle, zleDni };
  });

  const problemy = wiersze.filter((w) => w.zleDni > 0);
  const niepoliczone = [...new Set(bilanse.flatMap((b) => b.niepoliczone))];

  return (
    <>
      <p className="podtytul" style={{ marginBottom: 12 }}>
        Normy dzienne dla {plec === "K" ? "kobiety" : "mężczyzny"}
        {dni.length > 1 && ` · średnia z ${dni.length} dni`}
        {pokrycie < 1 && ` · policzone z ${Math.round(pokrycie * 100)}% masy jedzenia`}
      </p>

      <div className="kreator-podsumowanie" style={{ borderTop: "none", paddingTop: 0 }}>
        {wiersze.map(({ wzorzec, sredniProcent, srednioIle, zleDni }) => (
          <div key={wzorzec.klucz} className="kreator-wiersz-makro">
            <span className="bilans-etykieta">
              {wzorzec.nazwa}
              {wzorzec.typ === "limit" && <span className="bilans-limit"> maks.</span>}
            </span>
            <div className="kreator-pasek">
              <div
                className={`kreator-pasek-wypelnienie ${pasekStanu({ ...wzorzec, procent: sredniProcent, stan: zleDni > 0 ? wzorzec.stan : "ok" })}`}
                style={{ width: `${Math.min(sredniProcent, 130)}%` }}
              />
            </div>
            <span className="bilans-wartosc">
              {Math.round(srednioIle * 10) / 10}
              {wzorzec.jednostka} / {wzorzec.cel}
              {wzorzec.jednostka}
              <span className="bilans-procent"> {sredniProcent}%</span>
            </span>
          </div>
        ))}
      </div>

      {problemy.length > 0 && (
        <div className="kreator-ostrzezenie">
          ⚠{" "}
          {problemy
            .map(({ wzorzec, sredniProcent, zleDni }) => {
              const gdzie = dni.length > 1 ? ` (${zleDni} z ${dni.length} dni)` : "";
              return wzorzec.typ === "limit"
                ? `${wzorzec.nazwa.toLowerCase()} przekroczony o ${sredniProcent - 100}%${gdzie}`
                : `brakuje ${100 - sredniProcent}% ${wzorzec.nazwa.toLowerCase()}${gdzie}`;
            })
            .join(", ")}
          .
        </div>
      )}

      {niepoliczone.length > 0 && (
        <p className="podtytul" style={{ fontSize: "0.8rem", marginTop: 8 }}>
          Bez danych o mikroskładnikach (nie weszły do bilansu): {niepoliczone.join(", ")}.
        </p>
      )}
    </>
  );
}
