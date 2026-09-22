"use client";

import type { PozycjaListyZakupow } from "@/lib/engine/planner";

/**
 * Lista zakupów jako lista do odhaczania, a nie kartka do wydruku.
 *
 * Odhaczone pozycje trzymamy w `magazyn` (localStorage), więc przetrwają zamknięcie karty —
 * po to, żeby dało się iść do sklepu z telefonem w ręku i odhaczać w trakcie.
 */

interface Props {
  pozycje: PozycjaListyZakupow[];
  kupione: string[];
  liczbaOsob: number;
  onPrzelacz: (skladnikId: string) => void;
  onWyczysc: () => void;
  onPDF: () => void;
  onWroc: () => void;
}

export default function ListaZakupow({ pozycje, kupione, liczbaOsob, onPrzelacz, onWyczysc, onPDF, onWroc }: Props) {
  const odhaczone = new Set(kupione);
  const zostalo = pozycje.filter((p) => !odhaczone.has(p.skladnikId)).length;

  return (
    <>
      <h2>Lista zakupów{liczbaOsob > 1 ? ` (dla ${liczbaOsob} osób)` : ""}</h2>
      <p className="podtytul" style={{ marginBottom: 16 }}>
        {zostalo === 0 ? "Wszystko odhaczone 🎉" : `Zostało ${zostalo} z ${pozycje.length} pozycji`}
      </p>

      <div id="sekcja-lista-druk" className="zakupy-lista">
        {pozycje.map((pozycja) => {
          const kupione = odhaczone.has(pozycja.skladnikId);
          return (
            <button
              key={pozycja.skladnikId}
              className={`zakupy-pozycja ${kupione ? "kupione" : ""}`}
              onClick={() => onPrzelacz(pozycja.skladnikId)}
            >
              <span className="zakupy-ptaszek">{kupione ? "✓" : ""}</span>
              <span className="zakupy-nazwa">{pozycja.nazwa}</span>
              <span className="zakupy-ilosc">
                {Math.round(pozycja.ilosc * liczbaOsob * 10) / 10} {pozycja.jednostka}
              </span>
            </button>
          );
        })}
      </div>

      <div className="menu-akcje">
        <button className="btn-maly" onClick={onPDF}>
          📄 Pobierz PDF
        </button>
        <button className="btn-maly" onClick={onWyczysc}>
          Odznacz wszystko
        </button>
      </div>

      <div className="przyciski-nawigacji">
        <button className="btn btn-wstecz" onClick={onWroc}>
          ← Wróć
        </button>
      </div>
    </>
  );
}
