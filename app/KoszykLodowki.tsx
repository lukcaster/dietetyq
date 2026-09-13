"use client";

import { useEffect, useState } from "react";
import BilansMikro from "./BilansMikro";
import PropozycjeDokupienia from "./PropozycjeDokupienia";
import type { DaneAntropometryczne, SkladnikWPlanie } from "@/lib/engine/planner";
import type { Makro, PozycjaSpizarni } from "@/lib/engine/types";
import type { DzienZLodowki, JednostkaKoszyka } from "@/lib/engine/z-lodowki";

/**
 * Tryb "z lodówki" — user zbiera koszyk tego, co ma (albo na co ma ochotę), a silnik
 * rozdziela to na sloty i dobiera gramatury pod cel makro dnia. Bez przepisów: wynikiem
 * jest odpowiedź "co i ile zjeść", nie "jak to ugotować".
 *
 * Wyszukiwarka i liczenie makro idą przez API — `produkty.json` ma ~1 MB i zostaje na serwerze,
 * a silnik jest jedynym źródłem prawdy dla liczb.
 */

interface PozycjaWKoszyku {
  pozycja: PozycjaSpizarni;
  jednostka: JednostkaKoszyka;
  /** Puste = "mam dość, dobierz ile trzeba". */
  dostepneIlosc: number | "";
}

interface SkladnikNaPolce {
  id: string;
  nazwa: string;
  makroNa100g: Makro;
  masaSztuki?: number;
  tagiAlergenow: string[];
  zawszeWDomu?: boolean;
}

interface KategoriaSpizarni {
  grupa: string;
  skladniki: SkladnikNaPolce[];
}

interface Props {
  kcalDzienne?: number;
  dane?: DaneAntropometryczne;
  makro: { bialko: number; tluszcz: number; wegle: number };
  sloty: string[];
  onWstecz: () => void;
}

const ETYKIETY_SLOTOW: Record<string, string> = {
  sniadanie: "🌅 Śniadanie",
  "drugie-sniadanie": "🥪 II śniadanie",
  obiad: "🍽️ Obiad",
  podwieczorek: "🍓 Podwieczorek",
  kolacja: "🌙 Kolacja",
};

const ETYKIETY_MAKRO: { klucz: keyof Makro; label: string; jednostka: string }[] = [
  { klucz: "kcal", label: "kcal", jednostka: "" },
  { klucz: "bialko", label: "Białko", jednostka: "g" },
  { klucz: "tluszcz", label: "Tłuszcz", jednostka: "g" },
  { klucz: "wegle", label: "Węgle", jednostka: "g" },
];

function stanDopasowania(aktualne: number, cel: number): "ok" | "blisko" | "daleko" {
  if (cel <= 0) return "ok";
  const odchylenie = Math.abs((aktualne - cel) / cel) * 100;
  if (odchylenie <= 5) return "ok";
  return odchylenie <= 15 ? "blisko" : "daleko";
}

export default function KoszykLodowki({ kcalDzienne, dane, makro, sloty, onWstecz }: Props) {
  const [fraza, setFraza] = useState("");
  const [wyniki, setWyniki] = useState<PozycjaSpizarni[]>([]);
  const [szukam, setSzukam] = useState(false);
  const [koszyk, setKoszyk] = useState<PozycjaWKoszyku[]>([]);
  const [kategorie, setKategorie] = useState<KategoriaSpizarni[]>([]);
  const [dzien, setDzien] = useState<DzienZLodowki | null>(null);
  const [pracuje, setPracuje] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  /** Gramatury przypięte ręcznie przez usera, per posiłek: klucz `${indeksPosilku}:${skladnikId}`. */
  const [przypiete, setPrzypiete] = useState<Record<string, boolean>>({});
  const [korekty, setKorekty] = useState<Record<number, string[]>>({});

  // Kategorie spiżarni trzyma serwer (ingredients.json), żeby UI nie miał drugiej kopii bazy.
  useEffect(() => {
    fetch("/api/skladniki?grupowanie=lodowka")
      .then((o) => o.json())
      .then((wynik) => setKategorie(wynik.grupy ?? []))
      .catch(() => setBlad("Nie udało się wczytać listy składników"));
  }, []);

  useEffect(() => {
    if (fraza.trim().length < 2) {
      setWyniki([]);
      return;
    }
    const kontroler = new AbortController();
    const timer = setTimeout(async () => {
      setSzukam(true);
      try {
        const parametry = new URLSearchParams({ q: fraza, limit: "20" });
        const odpowiedz = await fetch(`/api/spizarnia?${parametry}`, { signal: kontroler.signal });
        const daneOdp = await odpowiedz.json();
        setWyniki(daneOdp.pozycje ?? []);
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
  }, [fraza]);

  function dodaj(pozycja: PozycjaSpizarni) {
    if (koszyk.some((p) => p.pozycja.id === pozycja.id)) return;
    setKoszyk((aktualne) => [
      ...aktualne,
      { pozycja, jednostka: pozycja.masaSztuki ? "szt" : "g", dostepneIlosc: "" },
    ]);
    setFraza("");
    setWyniki([]);
  }

  /** Kafelek na półce: klik wrzuca do koszyka, kolejny klik wyjmuje. */
  function przelacz(skladnik: SkladnikNaPolce) {
    if (koszyk.some((p) => p.pozycja.id === skladnik.id)) {
      setKoszyk((aktualne) => aktualne.filter((p) => p.pozycja.id !== skladnik.id));
      return;
    }
    dodaj({
      id: skladnik.id,
      nazwa: skladnik.nazwa,
      makroNa100g: skladnik.makroNa100g,
      masaSztuki: skladnik.masaSztuki,
      tagiAlergenow: skladnik.tagiAlergenow,
      alergenyNieznane: false,
      zrodlo: "baza",
    });
  }

  function zmien(indeks: number, zmiana: Partial<PozycjaWKoszyku>) {
    setKoszyk((aktualne) => aktualne.map((p, i) => (i === indeks ? { ...p, ...zmiana } : p)));
  }

  function usun(indeks: number) {
    setKoszyk((aktualne) => aktualne.filter((_, i) => i !== indeks));
  }

  async function rozpisz() {
    setPracuje(true);
    setBlad(null);
    // Nowy rozkład dnia to nowe posiłki — stare przypięcia i ostrzeżenia z korekt tracą sens.
    setPrzypiete({});
    setKorekty({});
    try {
      const odpowiedz = await fetch("/api/z-lodowki", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kcalDzienne,
          dane,
          makro,
          sloty,
          koszyk: koszyk.map((p) => ({
            id: p.pozycja.id,
            jednostka: p.jednostka,
            dostepneIlosc: p.dostepneIlosc === "" ? undefined : p.dostepneIlosc,
          })),
        }),
      });
      const wynik = await odpowiedz.json();
      if (!odpowiedz.ok) throw new Error(wynik.blad ?? "Nie udało się rozpisać dnia");
      setDzien(wynik);
    } catch (e) {
      setBlad(e instanceof Error ? e.message : "Nieznany błąd");
    } finally {
      setPracuje(false);
    }
  }

  function zsumujDzien(posilki: DzienZLodowki["posilki"]): Makro {
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

  /**
   * User wpisał gramaturę — przypinamy ją i każemy silnikowi przeliczyć resztę składników
   * tego posiłku pod cel slotu. Skład się nie zmienia, tylko proporcje.
   */
  async function zmienGramature(indeksPosilku: number, skladnikId: string, nowaIlosc: number) {
    if (!dzien || !Number.isFinite(nowaIlosc) || nowaIlosc < 0) return;
    const posilek = dzien.posilki[indeksPosilku];
    const przypieteTeraz = { ...przypiete, [`${indeksPosilku}:${skladnikId}`]: true };
    setPrzypiete(przypieteTeraz);

    setPracuje(true);
    setBlad(null);
    try {
      const odpowiedz = await fetch("/api/z-lodowki/przelicz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cel: dzien.celeSlotow[posilek.slot],
          pozycje: posilek.skladniki.map((s) => ({
            id: s.skladnikId,
            jednostka: s.jednostka,
            ilosc: s.skladnikId === skladnikId ? nowaIlosc : s.ilosc,
            stala: s.skladnikId === skladnikId || przypieteTeraz[`${indeksPosilku}:${s.skladnikId}`],
          })),
        }),
      });
      const wynik = await odpowiedz.json();
      if (!odpowiedz.ok) throw new Error(wynik.blad ?? "Nie udało się przeliczyć posiłku");

      // W tym trybie składniki bazowe to ta sama lista (żadnych komponentów do rozbicia),
      // ale trzeba ją podmienić razem ze składnikami — inaczej bilans liczyłby stare gramatury.
      const posilki = dzien.posilki.map((p, i) =>
        i === indeksPosilku
          ? {
              ...p,
              skladniki: wynik.skladniki,
              skladnikiBazowe: wynik.skladniki.map((s: SkladnikWPlanie) => ({ ...s })),
              makro: wynik.makro,
            }
          : p
      );
      setDzien({ ...dzien, posilki, makroDnia: zsumujDzien(posilki) });
      setKorekty((aktualne) => ({ ...aktualne, [indeksPosilku]: wynik.ostrzezenia ?? [] }));
    } catch (e) {
      setBlad(e instanceof Error ? e.message : "Nieznany błąd");
    } finally {
      setPracuje(false);
    }
  }

  function odepnij(indeksPosilku: number, skladnikId: string) {
    setPrzypiete((aktualne) => {
      const { [`${indeksPosilku}:${skladnikId}`]: _usuniety, ...reszta } = aktualne;
      return reszta;
    });
  }

  if (dzien) {
    return (
      <>
        <h2>Twój dzień z tego, co masz</h2>
        <p className="podtytul" style={{ marginBottom: 8 }}>
          Cel: {Math.round(dzien.kcalDzienne)} kcal · B: {Math.round(dzien.makroDzienne.bialko)}g · T:{" "}
          {Math.round(dzien.makroDzienne.tluszcz)}g · W: {Math.round(dzien.makroDzienne.wegle)}g
        </p>
        <p className="podtytul">
          Dania oznaczone jako <span className="znacznik znacznik-baza">przepis</span> mają gotowe instrukcje i
          skalują się w całości. W pozostałych możesz zmieniać gramatury — wpisz swoją ilość, zostanie{" "}
          <strong>przypięta</strong> 🔒, a resztę silnik przeliczy pod cel.
        </p>

        {dzien.ostrzezenia.map((tekst, i) => (
          <div key={i} className="kreator-ostrzezenie">
            ⚠ {tekst}
          </div>
        ))}

        {dzien.posilki.map((posilek, i) => {
          const cel = dzien.celeSlotow[posilek.slot];
          // Posiłek z szablonu ma id z prefiksem "szablon:" i nie ma instrukcji.
          const zPrzepisu = !posilek.recipeId.startsWith("szablon:");
          return (
            <div key={i} className="dzien-karta">
              <div className="dzien-naglowek">
                <h3>{ETYKIETY_SLOTOW[posilek.slot] ?? posilek.slot}</h3>
                <span className="podtytul">{Math.round(posilek.makro.kcal)} kcal</span>
              </div>
              <div className="posilek">
                <div className="posilek-nazwa">
                  {posilek.nazwa}
                  {zPrzepisu && <span className="znacznik znacznik-baza">przepis</span>}
                  {posilek.czasPrzygotowania && (
                    <span className="podtytul"> · {posilek.czasPrzygotowania} min</span>
                  )}
                </div>
                {posilek.uwaga && <span className="uwaga">⚠ {posilek.uwaga}</span>}

                {/* Gramatur przepisu nie da się zmieniać pojedynczo: proporcje są jego częścią,
                    a solver dosypałby mąki, zostawiając jajka. Przepis skalujemy w całości. */}
                {zPrzepisu
                  ? posilek.skladniki.map((s, j) => (
                      <div key={j} className="korekta-wiersz">
                        <span className="kreator-jednostka-staly">
                          {s.ilosc} {s.jednostka}
                        </span>
                        <span className="korekta-nazwa">{s.nazwa}</span>
                      </div>
                    ))
                  : posilek.skladniki.map((s, j) => {
                      const wpiete = przypiete[`${i}:${s.skladnikId}`];
                      return (
                        <div key={j} className="korekta-wiersz">
                          <input
                            className="kreator-ilosc"
                            type="number"
                            min={0}
                            step={s.jednostka === "szt" ? 1 : 5}
                            defaultValue={s.ilosc}
                            disabled={pracuje}
                            // onBlur, nie onChange — przeliczanie przy każdym wciśniętym klawiszu
                            // to zapytanie na znak i skaczące liczby pod palcami.
                            onBlur={(e) => {
                              const wartosc = Number(e.target.value);
                              if (wartosc !== s.ilosc) zmienGramature(i, s.skladnikId, wartosc);
                            }}
                            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                          />
                          <span className="kreator-jednostka-staly">{s.jednostka}</span>
                          <span className="korekta-nazwa">{s.nazwa}</span>
                          {wpiete && (
                            <button
                              className="kreator-blokada wlaczona"
                              title="Ta ilość jest przypięta — kliknij, żeby silnik znów mógł ją zmieniać"
                              onClick={() => odepnij(i, s.skladnikId)}
                            >
                              🔒
                            </button>
                          )}
                        </div>
                      );
                    })}

                {posilek.instrukcje.length > 0 && (
                  <>
                    <p className="podtytul" style={{ marginTop: 12, marginBottom: 4 }}>
                      Jak to zrobić:
                    </p>
                    <ol className="instrukcje">
                      {posilek.instrukcje.map((krok, k) => (
                        <li key={k} className="posilek-makro">
                          {krok}
                        </li>
                      ))}
                    </ol>
                  </>
                )}

                {korekty[i]?.map((tekst, k) => (
                  <div key={k} className="kreator-ostrzezenie">
                    ⚠ {tekst}
                  </div>
                ))}

                <div className="kreator-podsumowanie">
                  {ETYKIETY_MAKRO.map(({ klucz, label, jednostka }) => {
                    const aktualne = posilek.makro[klucz];
                    const docelowe = cel[klucz];
                    const procent = docelowe > 0 ? Math.min((aktualne / docelowe) * 100, 130) : 0;
                    return (
                      <div key={klucz} className="kreator-wiersz-makro">
                        <span className="kreator-etykieta">{label}</span>
                        <div className="kreator-pasek">
                          <div
                            className={`kreator-pasek-wypelnienie ${stanDopasowania(aktualne, docelowe)}`}
                            style={{ width: `${procent}%` }}
                          />
                        </div>
                        <span className="kreator-wartosc">
                          {Math.round(aktualne)} / {Math.round(docelowe)}
                          {jednostka}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}

        <h2>Razem w ciągu dnia</h2>
        <p className="podtytul">
          {Math.round(dzien.makroDnia.kcal)} / {Math.round(dzien.makroDzienne.kcal)} kcal · B:{" "}
          {Math.round(dzien.makroDnia.bialko)} / {Math.round(dzien.makroDzienne.bialko)}g · T:{" "}
          {Math.round(dzien.makroDnia.tluszcz)} / {Math.round(dzien.makroDzienne.tluszcz)}g · W:{" "}
          {Math.round(dzien.makroDnia.wegle)} / {Math.round(dzien.makroDzienne.wegle)}g
        </p>

        <h2>Bilans mikroskładników</h2>
        <BilansMikro
          dni={[dzien.posilki.flatMap((p) => p.skladnikiBazowe)]}
          plec={dane?.plec}
        />

        {dzien.resztki.length > 0 && (
          <>
            <h2>Zostaje ci w lodówce</h2>
            <div className="lista-zakupow">
              {dzien.resztki.map((r) => (
                <div key={r.id} className="lista-zakupow-pozycja">
                  {r.nazwa}: {r.zostalo} {r.jednostka}
                </div>
              ))}
            </div>
          </>
        )}

        <PropozycjeDokupienia propozycje={dzien.propozycje} />

        <div className="przyciski-nawigacji">
          <button className="btn btn-wstecz" onClick={() => setDzien(null)}>
            Zmień koszyk
          </button>
          <button className="btn btn-dalej" disabled={pracuje} onClick={rozpisz}>
            {pracuje ? "Liczę..." : "Przelicz jeszcze raz"}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2>Co masz w lodówce?</h2>
      <p className="podtytul">
        Dorzuć wszystko, co masz pod ręką albo na co masz ochotę. Silnik sam zdecyduje, co wrzucić w który
        posiłek i w jakiej gramaturze. Ilość podajesz tylko wtedy, gdy czegoś masz ograniczoną ilość.
      </p>

      {kategorie.length === 0 && <p className="podtytul">Wczytuję spiżarnię...</p>}

      {(() => {
        const zDomu = kategorie.flatMap((k) => k.skladniki.filter((s) => s.zawszeWDomu));
        if (zDomu.length === 0) return null;
        return (
          <p className="podtytul" style={{ marginTop: -8, marginBottom: 20 }}>
            🛢️ Zakładam, że masz w domu: <strong>{zDomu.map((s) => s.nazwa.toLowerCase()).join(", ")}</strong> —
            nie musisz ich dodawać. Dodaj tylko wtedy, gdy chcesz ograniczyć ilość.
          </p>
        );
      })()}

      {kategorie.map((kategoria) => (
        <div key={kategoria.grupa} className="pref-grupa">
          <div className="pref-grupa-nazwa">{kategoria.grupa}</div>
          <div className="pref-chipsy">
            {kategoria.skladniki.map((skladnik) => {
              const wKoszyku = koszyk.some((p) => p.pozycja.id === skladnik.id);
              return (
                <button
                  key={skladnik.id}
                  className={`pref-chip ${wKoszyku ? "lubie" : ""}`}
                  onClick={() => przelacz(skladnik)}
                >
                  {wKoszyku ? "✓ " : "+ "}
                  {skladnik.nazwa}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <h2 style={{ marginTop: 28 }}>Nie ma tego na półce?</h2>
      <p className="podtytul" style={{ marginBottom: 12 }}>
        Poszukaj wśród produktów sklepowych — konkretna marka z kodem kreskowym.
      </p>

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
                {wynik.marka ? ` (${wynik.marka})` : ""}
                <span className={`znacznik ${wynik.zrodlo === "baza" ? "znacznik-baza" : "znacznik-sklep"}`}>
                  {wynik.zrodlo === "baza" ? "baza" : "sklep"}
                </span>
                {wynik.alergenyNieznane && <span className="znacznik znacznik-uwaga">alergeny?</span>}
              </span>
              <span className="posilek-makro">
                {Math.round(wynik.makroNa100g.kcal)} kcal · B {wynik.makroNa100g.bialko} · T{" "}
                {wynik.makroNa100g.tluszcz} · W {wynik.makroNa100g.wegle} (na 100 g)
              </span>
            </button>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: 28 }}>
        Twój koszyk{koszyk.length > 0 && ` (${koszyk.length})`}
      </h2>
      {koszyk.length === 0 ? (
        <p className="podtytul">Pusty — klikaj składniki na półkach wyżej.</p>
      ) : (
        <p className="podtytul" style={{ marginBottom: 12 }}>
          Ilość wpisz tylko tam, gdzie masz ograniczony zapas. Reszta = „mam dość, dobierz ile trzeba".
        </p>
      )}

      {koszyk.map((p, i) => (
        <div key={p.pozycja.id} className="kreator-pozycja">
          <div className="kreator-pozycja-opis">
            <span className="posilek-nazwa">
              {p.pozycja.nazwa}
              {p.pozycja.marka ? ` (${p.pozycja.marka})` : ""}
            </span>
            <span className="posilek-makro">{Math.round(p.pozycja.makroNa100g.kcal)} kcal/100 g</span>
          </div>

          <div className="kreator-sterowanie">
            <input
              className="kreator-ilosc"
              type="number"
              min={0}
              placeholder="ile mam"
              value={p.dostepneIlosc}
              onChange={(e) => zmien(i, { dostepneIlosc: e.target.value === "" ? "" : Number(e.target.value) })}
            />
            {p.pozycja.masaSztuki ? (
              <select
                className="kreator-jednostka"
                value={p.jednostka}
                onChange={(e) => zmien(i, { jednostka: e.target.value as JednostkaKoszyka })}
              >
                <option value="szt">szt</option>
                <option value="g">g</option>
              </select>
            ) : (
              <span className="kreator-jednostka-staly">g</span>
            )}
            <span className="posilek-makro">{p.dostepneIlosc === "" ? "mam dość" : "tyle mam i tyle"}</span>
            <button className="kreator-usun" onClick={() => usun(i)} title="Usuń z koszyka">
              ✕
            </button>
          </div>
        </div>
      ))}

      {blad && <div className="blad">{blad}</div>}

      <div className="przyciski-nawigacji">
        <button className="btn btn-wstecz" onClick={onWstecz}>
          Wstecz
        </button>
        <button className="btn btn-dalej" disabled={koszyk.length === 0 || pracuje} onClick={rozpisz}>
          {pracuje ? "Liczę..." : "Rozpisz mi dzień"}
        </button>
      </div>
    </>
  );
}
