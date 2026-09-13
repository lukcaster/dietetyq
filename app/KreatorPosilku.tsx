"use client";

import { useEffect, useState } from "react";
import type { PosilekWPlanie } from "@/lib/engine/planner";
import type { Makro, PozycjaSpizarni } from "@/lib/engine/types";

/**
 * Kreator własnego posiłku: user wyszukuje składniki (kuratorowana baza + produkty sklepowe),
 * ustawia gramatury albo blokuje te, na których mu zależy ("150 g piersi"), a solver dobiera resztę
 * pod cel makro slotu. Podgląd makro liczymy lokalnie, żeby reagował na każdą zmianę bez zapytania;
 * dopasowanie i zapis idą przez API, bo to silnik jest źródłem prawdy dla liczb.
 */

type Jednostka = "g" | "ml" | "szt";

interface PozycjaWKreatorze {
  pozycja: PozycjaSpizarni;
  ilosc: number;
  jednostka: Jednostka;
  stala: boolean;
}

interface Props {
  slot: string;
  cel: Makro;
  restrykcje: string[];
  onZapisz: (posilek: PosilekWPlanie) => void;
  onAnuluj: () => void;
}

const ETYKIETY_MAKRO: { klucz: keyof Makro; label: string; jednostka: string }[] = [
  { klucz: "kcal", label: "kcal", jednostka: "" },
  { klucz: "bialko", label: "Białko", jednostka: "g" },
  { klucz: "tluszcz", label: "Tłuszcz", jednostka: "g" },
  { klucz: "wegle", label: "Węgle", jednostka: "g" },
];

function makroPozycji(p: PozycjaWKreatorze): Makro {
  const gramy = p.jednostka === "szt" ? p.ilosc * (p.pozycja.masaSztuki ?? 0) : p.ilosc;
  const w = gramy / 100;
  return {
    kcal: p.pozycja.makroNa100g.kcal * w,
    bialko: p.pozycja.makroNa100g.bialko * w,
    tluszcz: p.pozycja.makroNa100g.tluszcz * w,
    wegle: p.pozycja.makroNa100g.wegle * w,
  };
}

function sumaMakro(pozycje: PozycjaWKreatorze[]): Makro {
  return pozycje.reduce(
    (suma, p) => {
      const m = makroPozycji(p);
      return {
        kcal: suma.kcal + m.kcal,
        bialko: suma.bialko + m.bialko,
        tluszcz: suma.tluszcz + m.tluszcz,
        wegle: suma.wegle + m.wegle,
      };
    },
    { kcal: 0, bialko: 0, tluszcz: 0, wegle: 0 }
  );
}

/** Kolor paska: zielony = trafione, żółty = do przyjęcia, różowy = rozjazd. */
function stanDopasowania(aktualne: number, cel: number): "ok" | "blisko" | "daleko" {
  if (cel <= 0) return "ok";
  const odchylenie = Math.abs((aktualne - cel) / cel) * 100;
  if (odchylenie <= 5) return "ok";
  return odchylenie <= 15 ? "blisko" : "daleko";
}

export default function KreatorPosilku({ slot, cel, restrykcje, onZapisz, onAnuluj }: Props) {
  const [nazwa, setNazwa] = useState("");
  const [fraza, setFraza] = useState("");
  const [wyniki, setWyniki] = useState<PozycjaSpizarni[]>([]);
  const [szukam, setSzukam] = useState(false);
  const [pozycje, setPozycje] = useState<PozycjaWKreatorze[]>([]);
  const [ostrzezenia, setOstrzezenia] = useState<string[]>([]);
  const [blad, setBlad] = useState<string | null>(null);
  const [pracuje, setPracuje] = useState(false);

  const restrykcjeKlucz = restrykcje.join(",");

  useEffect(() => {
    if (fraza.trim().length < 2) {
      setWyniki([]);
      return;
    }
    const kontroler = new AbortController();
    const timer = setTimeout(async () => {
      setSzukam(true);
      try {
        const parametry = new URLSearchParams({ q: fraza, restrykcje: restrykcjeKlucz, limit: "20" });
        const odpowiedz = await fetch(`/api/spizarnia?${parametry}`, { signal: kontroler.signal });
        const dane = await odpowiedz.json();
        setWyniki(dane.pozycje ?? []);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) setWyniki([]);
      } finally {
        setSzukam(false);
      }
    }, 250);

    return () => {
      kontroler.abort();
      clearTimeout(timer);
    };
  }, [fraza, restrykcjeKlucz]);

  function dodaj(pozycja: PozycjaSpizarni) {
    const jednostka: Jednostka = pozycja.masaSztuki ? "szt" : "g";
    setPozycje((aktualne) => [...aktualne, { pozycja, ilosc: jednostka === "szt" ? 1 : 100, jednostka, stala: false }]);
    setFraza("");
    setWyniki([]);
  }

  function zmien(indeks: number, zmiana: Partial<PozycjaWKreatorze>) {
    setPozycje((aktualne) => aktualne.map((p, i) => (i === indeks ? { ...p, ...zmiana } : p)));
  }

  function usun(indeks: number) {
    setPozycje((aktualne) => aktualne.filter((_, i) => i !== indeks));
  }

  async function wyslij(dopasuj: boolean): Promise<PosilekWPlanie | null> {
    setPracuje(true);
    setBlad(null);
    try {
      const odpowiedz = await fetch("/api/posilek/dopasuj", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot,
          nazwa,
          cel,
          dopasuj,
          restrykcje,
          pozycje: pozycje.map((p) => ({
            id: p.pozycja.id,
            ilosc: p.ilosc,
            jednostka: p.jednostka,
            stala: p.stala,
          })),
        }),
      });
      const wynik = await odpowiedz.json();
      if (!odpowiedz.ok) throw new Error(wynik.blad ?? "Nie udało się policzyć posiłku");
      setOstrzezenia(wynik.ostrzezenia ?? []);
      return wynik.posilek as PosilekWPlanie;
    } catch (e) {
      setBlad(e instanceof Error ? e.message : "Nieznany błąd");
      return null;
    } finally {
      setPracuje(false);
    }
  }

  async function dopasujGramatury() {
    const posilek = await wyslij(true);
    if (!posilek) return;
    // Kolejność pozycji jest zachowana przez silnik, więc mapujemy po indeksie.
    setPozycje((aktualne) => aktualne.map((p, i) => ({ ...p, ilosc: posilek.skladniki[i]?.ilosc ?? p.ilosc })));
  }

  async function zapisz() {
    const posilek = await wyslij(false);
    if (posilek) onZapisz(posilek);
  }

  const suma = sumaMakro(pozycje);

  return (
    <div className="kreator">
      <h2>Zbuduj posiłek sam</h2>
      <p className="podtytul">
        Cel na ten posiłek ({slot}): {Math.round(cel.kcal)} kcal · B: {Math.round(cel.bialko)}g · T:{" "}
        {Math.round(cel.tluszcz)}g · W: {Math.round(cel.wegle)}g
      </p>

      <input
        className="kreator-input"
        placeholder="Nazwa posiłku (np. Smażony kurczak z ryżem)"
        value={nazwa}
        onChange={(e) => setNazwa(e.target.value)}
      />

      <input
        className="kreator-input"
        placeholder="Szukaj składnika lub produktu ze sklepu..."
        value={fraza}
        onChange={(e) => setFraza(e.target.value)}
      />

      {szukam && <p className="posilek-makro">Szukam...</p>}

      {wyniki.length > 0 && (
        <div className="kreator-wyniki">
          {wyniki.map((wynik) => (
            <button key={wynik.id} className="kreator-wynik" onClick={() => dodaj(wynik)}>
              <span className="kreator-wynik-nazwa">
                {wynik.nazwa}
                {wynik.marka && <span className="podtytul"> · {wynik.marka}</span>}
              </span>
              <span className="posilek-makro">
                {Math.round(wynik.makroNa100g.kcal)} kcal / 100 g · B: {wynik.makroNa100g.bialko} · T:{" "}
                {wynik.makroNa100g.tluszcz} · W: {wynik.makroNa100g.wegle}
                {wynik.zrodlo === "baza" ? (
                  <span className="znacznik znacznik-baza">baza</span>
                ) : (
                  <span className="znacznik znacznik-sklep">sklep</span>
                )}
                {wynik.alergenyNieznane && <span className="znacznik znacznik-uwaga">alergeny?</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {pozycje.length === 0 && <p className="posilek-makro">Dodaj składniki, z których ma się składać ten posiłek.</p>}

      {pozycje.map((p, i) => (
        <div key={`${p.pozycja.id}-${i}`} className="kreator-pozycja">
          <div className="kreator-pozycja-opis">
            <span className="posilek-nazwa">
              {p.pozycja.nazwa}
              {p.pozycja.marka && <span className="podtytul"> · {p.pozycja.marka}</span>}
            </span>
            <span className="posilek-makro">{Math.round(makroPozycji(p).kcal)} kcal</span>
          </div>

          <div className="kreator-sterowanie">
            <input
              className="kreator-ilosc"
              type="number"
              min={0}
              value={p.ilosc}
              onChange={(e) => zmien(i, { ilosc: e.target.value === "" ? 0 : Number(e.target.value) })}
            />
            {p.pozycja.masaSztuki ? (
              <select
                className="kreator-jednostka"
                value={p.jednostka}
                onChange={(e) => zmien(i, { jednostka: e.target.value as Jednostka })}
              >
                <option value="szt">szt</option>
                <option value="g">g</option>
              </select>
            ) : (
              <span className="kreator-jednostka-staly">g</span>
            )}
            <button
              className={`kreator-blokada ${p.stala ? "wlaczona" : ""}`}
              onClick={() => zmien(i, { stala: !p.stala })}
              title={p.stala ? "Ilość zablokowana — solver jej nie ruszy" : "Solver może zmienić tę ilość"}
            >
              {p.stala ? "🔒 stałe" : "🔓 elastyczne"}
            </button>
            <button className="kreator-usun" onClick={() => usun(i)} title="Usuń składnik">
              ✕
            </button>
          </div>
        </div>
      ))}

      {pozycje.length > 0 && (
        <div className="kreator-podsumowanie">
          {ETYKIETY_MAKRO.map(({ klucz, label, jednostka }) => {
            const aktualne = suma[klucz];
            const docelowe = cel[klucz];
            const stan = stanDopasowania(aktualne, docelowe);
            const procent = docelowe > 0 ? Math.min((aktualne / docelowe) * 100, 130) : 0;
            return (
              <div key={klucz} className="kreator-wiersz-makro">
                <span className="kreator-etykieta">{label}</span>
                <div className="kreator-pasek">
                  <div className={`kreator-pasek-wypelnienie ${stan}`} style={{ width: `${procent}%` }} />
                </div>
                <span className="kreator-wartosc">
                  {Math.round(aktualne)} / {Math.round(docelowe)}
                  {jednostka}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {ostrzezenia.map((tekst, i) => (
        <div key={i} className="kreator-ostrzezenie">
          ⚠ {tekst}
        </div>
      ))}

      {blad && <div className="blad">{blad}</div>}

      <div className="przyciski-nawigacji">
        <button className="btn btn-wstecz" onClick={onAnuluj}>
          Anuluj
        </button>
        <button className="btn btn-wstecz" disabled={pozycje.length === 0 || pracuje} onClick={dopasujGramatury}>
          {pracuje ? "Liczę..." : "Dopasuj gramatury"}
        </button>
        <button className="btn btn-dalej" disabled={pozycje.length === 0 || pracuje} onClick={zapisz}>
          Zapisz posiłek
        </button>
      </div>
    </div>
  );
}
