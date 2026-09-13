"use client";

import type { PropozycjaDokupienia, PropozycjeDokupienia as Propozycje } from "@/lib/engine/propozycje-dokupienia";

/**
 * „Dokup i zrobisz" pod planem dnia z lodówki: 2-3 wylosowane przepisy, do których brakuje
 * niewiele, plus rozwijana lista wszystkich przepisów z brakami. Silnik losuje wyróżnione
 * przy każdym przeliczeniu, więc „Przelicz jeszcze raz" daje też nowe podpowiedzi.
 */

const ETYKIETY_SLOTOW: Record<string, string> = {
  sniadanie: "śniadanie",
  "drugie-sniadanie": "II śniadanie",
  obiad: "obiad",
  podwieczorek: "podwieczorek",
  kolacja: "kolacja",
};

function lista(nazwy: string[]): string {
  const male = nazwy.map((n) => n.toLowerCase());
  if (male.length <= 1) return male.join("");
  return `${male.slice(0, -1).join(", ")} i ${male[male.length - 1]}`;
}

function SzczegolyPrzepisu({ propozycja }: { propozycja: PropozycjaDokupienia }) {
  return (
    <div className="propozycja-szczegoly">
      <p className="posilek-makro">
        {propozycja.slot.map((s) => ETYKIETY_SLOTOW[s] ?? s).join(" / ")} · {propozycja.czasPrzygotowania} min ·
        przepis na {propozycja.porcje} {propozycja.porcje === 1 ? "porcję" : "porcje"}
      </p>

      <div className="propozycja-kolumny">
        <div>
          <div className="propozycja-etykieta brakuje">Do dokupienia</div>
          <ul className="propozycja-lista">
            {propozycja.brakuje.map((b) => (
              <li key={b.id}>
                {b.nazwa} <span className="posilek-makro">· {b.ilosc} {b.jednostka}</span>
                {b.zamienniki && (
                  <div className="posilek-makro">albo: {lista(b.zamienniki)}</div>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="propozycja-etykieta masz">Masz w lodówce</div>
          <ul className="propozycja-lista">
            {propozycja.masz.map((nazwa) => (
              <li key={nazwa}>{nazwa}</li>
            ))}
          </ul>
        </div>
      </div>

      {propozycja.instrukcje.length > 0 && (
        <details className="propozycja-instrukcje">
          <summary>Jak to zrobić</summary>
          <ol className="instrukcje">
            {propozycja.instrukcje.map((krok, k) => (
              <li key={k} className="posilek-makro">
                {krok}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

export default function PropozycjeDokupienia({ propozycje }: { propozycje: Propozycje }) {
  if (propozycje.wszystkie.length === 0) return null;

  const poId = new Map(propozycje.wszystkie.map((p) => [p.recipeId, p]));
  const wyroznione = propozycje.wyroznione.map((id) => poId.get(id)).filter((p) => p !== undefined);

  return (
    <>
      <h2>🛒 Dokup i zrobisz</h2>
      <p className="podtytul" style={{ marginBottom: 12 }}>
        Do tych przepisów masz już część składników — wystarczy dokupić resztę.
      </p>

      {wyroznione.map((p) => (
        <details key={p.recipeId} className="propozycja propozycja-wyrozniona">
          <summary>
            {/* Nazwy składników są w mianowniku, więc „dokup: mąka" zamiast łamanego „dokup mąka". */}
            <span>
              Dokup: <strong className="propozycja-zakup">{lista(p.brakuje.map((b) => b.nazwa))}</strong> → zrobisz{" "}
              <strong>{p.nazwa}</strong>
            </span>
            <span className="znacznik znacznik-uwaga">
              brakuje {p.brakuje.length}/{p.wszystkich}
            </span>
          </summary>
          <SzczegolyPrzepisu propozycja={p} />
        </details>
      ))}

      <details className="propozycja-wszystkie">
        <summary>
          Wszystkie przepisy, do których czegoś brakuje ({propozycje.wszystkie.length})
        </summary>
        {propozycje.wszystkie.map((p) => (
          <details key={p.recipeId} className="propozycja">
            <summary>
              <span className="posilek-nazwa">{p.nazwa}</span>
              <span className={`znacznik ${p.brakuje.length * 2 <= p.wszystkich ? "znacznik-baza" : "znacznik-uwaga"}`}>
                brakuje {p.brakuje.length}/{p.wszystkich}
              </span>
            </summary>
            <SzczegolyPrzepisu propozycja={p} />
          </details>
        ))}
      </details>
    </>
  );
}
