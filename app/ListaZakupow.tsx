"use client";

import { NAZWY_SEKCJI, SEKCJE_SKLEPU, sekcjaSkladnika, type PozycjaListyZakupow } from "@/lib/engine/lista-zakupow";

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
  const doKupienia = pozycje.filter((p) => !odhaczone.has(p.skladnikId));
  const wKoszyku = pozycje.filter((p) => odhaczone.has(p.skladnikId));
  const zostalo = doKupienia.length;

  /** Plan zapisany starszą wersją nie ma pola `sekcja` — dolicz je z id zamiast zgubić pozycję. */
  const sekcjaPozycji = (p: PozycjaListyZakupow) => p.sekcja ?? sekcjaSkladnika(p.skladnikId);

  function Pozycja({ pozycja, kupione }: { pozycja: PozycjaListyZakupow; kupione: boolean }) {
    return (
      <button
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
  }

  return (
    <>
      <h2>Lista zakupów{liczbaOsob > 1 ? ` (dla ${liczbaOsob} osób)` : ""}</h2>
      <p className="podtytul" style={{ marginBottom: 16 }}>
        {zostalo === 0 ? "Wszystko odhaczone 🎉" : `Zostało ${zostalo} z ${pozycje.length} pozycji`}
      </p>

      <div id="sekcja-lista-druk" className="zakupy-lista">
        {SEKCJE_SKLEPU.map((sekcja) => {
          const wSekcji = doKupienia.filter((p) => sekcjaPozycji(p) === sekcja);
          if (wSekcji.length === 0) return null;
          return (
            <div key={sekcja} className="zakupy-sekcja">
              <h3 className="zakupy-naglowek">{NAZWY_SEKCJI[sekcja]}</h3>
              {wSekcji.map((pozycja) => (
                <Pozycja key={pozycja.skladnikId} pozycja={pozycja} kupione={false} />
              ))}
            </div>
          );
        })}

        {/* Odhaczone schodzą pod kreskę zamiast zostawać w swoim dziale: w sklepie liczy się
            to, czego jeszcze nie masz, a przekreślone pozycje tylko zaśmiecały listę. */}
        {wKoszyku.length > 0 && (
          <div className="zakupy-sekcja">
            <h3 className="zakupy-naglowek">🛒 Mam już w koszyku ({wKoszyku.length})</h3>
            {wKoszyku.map((pozycja) => (
              <Pozycja key={pozycja.skladnikId} pozycja={pozycja} kupione />
            ))}
          </div>
        )}
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
