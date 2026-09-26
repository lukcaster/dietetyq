"use client";

import { useEffect, useMemo, useState } from "react";
import type { Makro } from "@/lib/engine/types";

/**
 * Przeglądarka przepisów do ręcznego układania planu.
 *
 * Pokazuje wszystkie dania pasujące do slotu, z wyszukiwarką i filtrem po rodzaju potrawy —
 * przy 229 przepisach sama lista byłaby nie do przejrzenia. Makro jest podane **na porcję
 * z przepisu**, a obok cel slotu, żeby user widział, czy dane danie w ogóle w niego celuje;
 * po wybraniu i tak zostanie przeskalowane.
 */

interface PrzepisZListy {
  id: string;
  nazwa: string;
  slot: string[];
  charakter: string;
  porcje: number;
  czasPrzygotowania: string;
  czasOczekiwania: string | null;
  rodzaj?: string;
  wykonalnyPrzyRestrykcjach: boolean;
  makroNaPorcje: Makro | null;
}

const ETYKIETY_RODZAJOW: Record<string, string> = {
  jajka: "🍳 jajka",
  nalesniki: "🥞 naleśniki",
  owsianki: "🥣 owsianki",
  kanapki: "🥪 kanapki",
  wrapy: "🌯 wrapy",
  zupy: "🍲 zupy",
  jednogarnkowe: "🥘 jednogarnkowe",
  miesoZDodatkiem: "🍖 mięso z dodatkami",
  makarony: "🍝 makarony",
  kluski: "🥟 pierogi i kluski",
  salatki: "🥗 sałatki",
  koktajle: "🥤 koktajle",
  wypieki: "🍕 wypieki",
  przekaski: "🍫 przekąski",
};

interface Props {
  slot: string;
  cel: Makro;
  restrykcje: string[];
  nielubiane: string[];
  onWybierz: (recipeId: string) => void;
  onAnuluj: () => void;
  pracuje?: boolean;
}

export default function WybierzPrzepis({ slot, cel, restrykcje, nielubiane, onWybierz, onAnuluj, pracuje }: Props) {
  const [przepisy, setPrzepisy] = useState<PrzepisZListy[] | null>(null);
  const [fraza, setFraza] = useState("");
  const [rodzaj, setRodzaj] = useState<string | null>(null);
  const [blad, setBlad] = useState<string | null>(null);

  useEffect(() => {
    const parametry = new URLSearchParams({ slot });
    if (restrykcje.length) parametry.set("wyklucz", restrykcje.join(","));
    if (nielubiane.length) parametry.set("nielubiane", nielubiane.join(","));
    fetch(`/api/recipes?${parametry}`)
      .then((o) => o.json())
      .then((w) => setPrzepisy(w.przepisy ?? []))
      .catch(() => setBlad("Nie udało się wczytać listy przepisów"));
  }, [slot, restrykcje, nielubiane]);

  /** Rodzaje faktycznie obecne w tym slocie — nie pokazujemy filtrów, które nic nie dają. */
  const dostepneRodzaje = useMemo(() => {
    const zbior = new Set((przepisy ?? []).map((p) => p.rodzaj).filter((r): r is string => !!r));
    return [...zbior].sort((a, b) => (ETYKIETY_RODZAJOW[a] ?? a).localeCompare(ETYKIETY_RODZAJOW[b] ?? b, "pl"));
  }, [przepisy]);

  const widoczne = useMemo(() => {
    const szukane = fraza.trim().toLowerCase();
    return (przepisy ?? [])
      .filter((p) => p.wykonalnyPrzyRestrykcjach)
      .filter((p) => (rodzaj ? p.rodzaj === rodzaj : true))
      .filter((p) => (szukane ? p.nazwa.toLowerCase().includes(szukane) : true))
      // Najbliżej celu kcal na górze — to zwykle te, które po przeskalowaniu zmienią się najmniej.
      .sort((a, b) => {
        const od = (p: PrzepisZListy) => (p.makroNaPorcje ? Math.abs(p.makroNaPorcje.kcal - cel.kcal) : Infinity);
        return od(a) - od(b);
      });
  }, [przepisy, fraza, rodzaj, cel.kcal]);

  return (
    <div className="modal-tlo" onClick={onAnuluj}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Wybierz przepis</h2>
        <p className="podtytul" style={{ marginBottom: 12 }}>
          Cel tego posiłku: {Math.round(cel.kcal)} kcal · B {Math.round(cel.bialko)}g · T {Math.round(cel.tluszcz)}g ·
          W {Math.round(cel.wegle)}g. Wybrany przepis przeskalujemy do tego celu.
        </p>

        <input
          className="kreator-input"
          placeholder="Szukaj po nazwie…"
          value={fraza}
          onChange={(e) => setFraza(e.target.value)}
        />

        {dostepneRodzaje.length > 1 && (
          <div className="pref-chipsy" style={{ marginTop: 10 }}>
            <button className={`pref-chip ${rodzaj === null ? "lubie" : ""}`} onClick={() => setRodzaj(null)}>
              wszystko
            </button>
            {dostepneRodzaje.map((r) => (
              <button
                key={r}
                className={`pref-chip ${rodzaj === r ? "lubie" : ""}`}
                onClick={() => setRodzaj(rodzaj === r ? null : r)}
              >
                {ETYKIETY_RODZAJOW[r] ?? r}
              </button>
            ))}
          </div>
        )}

        {blad && <div className="blad">{blad}</div>}
        {!przepisy && !blad && (
          <div className="ladowanie">
            <div className="spinner" />
          </div>
        )}

        {przepisy && (
          <>
            <p className="podtytul" style={{ marginTop: 14, marginBottom: 8 }}>
              {widoczne.length} {widoczne.length === 1 ? "przepis" : "przepisów"} do wyboru
            </p>
            <div className="lista-przepisow">
              {widoczne.map((p) => (
                <button
                  key={p.id}
                  className="propozycja-wymiany"
                  disabled={pracuje}
                  onClick={() => onWybierz(p.id)}
                >
                  <span className="posilek-nazwa">{p.nazwa}</span>
                  <span className="posilek-makro">
                    {p.makroNaPorcje
                      ? `${Math.round(p.makroNaPorcje.kcal)} kcal · B ${Math.round(p.makroNaPorcje.bialko)}g · T ${Math.round(
                          p.makroNaPorcje.tluszcz
                        )}g · W ${Math.round(p.makroNaPorcje.wegle)}g (porcja z przepisu)`
                      : "makro nieznane"}
                  </span>
                  <span className="posilek-makro">
                    {p.czasPrzygotowania} min
                    {p.czasOczekiwania ? ` · wymaga: ${p.czasOczekiwania}` : ""}
                    {p.rodzaj ? ` · ${ETYKIETY_RODZAJOW[p.rodzaj] ?? p.rodzaj}` : ""}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="menu-akcje">
          <button className="btn-maly" onClick={onAnuluj}>
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
