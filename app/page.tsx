"use client";

import { useEffect, useState } from "react";
import BilansMikro from "./BilansMikro";
import ListaZakupow from "./ListaZakupow";
import ModalWymiany from "./ModalWymiany";
import MojPlan, { kluczPosilku } from "./MojPlan";
import Onboarding from "./Onboarding";
import UlozSam from "./UlozSam";
import { zbudujListeZakupow } from "@/lib/engine/lista-zakupow";
import type { DzienWPlanie, PosilekWPlanie, WygenerowanyPlan } from "@/lib/engine/planner";
import type { DaneAntropometryczne } from "@/lib/engine/cele";
import { celeSlotowDla } from "@/lib/engine/cele";
import { magazyn, SLOTY_DLA_LICZBY, type Profil } from "@/lib/magazyn";

/**
 * Szkielet aplikacji.
 *
 * Poprzednia wersja była sześciokrokowym kreatorem, który przy każdym planie pytał o wszystko
 * od nowa. Teraz user wypełnia ankietę **raz** (profil w `lib/magazyn.ts`), a potem widzi menu
 * i swój plan. Tryb „z lodówki" jest na razie schowany — kod zostaje, ale wejścia z menu nie ma,
 * bo jakość wyników była słaba (patrz TODO).
 */

type Widok = "menu" | "podglad" | "plan" | "calyPlan" | "zakupy" | "profil" | "ulozSam";

const NAZWY_SLOTOW: Record<string, string> = {
  sniadanie: "🌅 Śniadanie",
  "drugie-sniadanie": "🥪 II śniadanie",
  obiad: "🍽️ Obiad",
  podwieczorek: "🍓 Podwieczorek",
  kolacja: "🌙 Kolacja",
};

/** Etykiety rodzajów potraw — te same, co w ankiecie (app/Onboarding.tsx). */
const ETYKIETY_RODZAJOW: Record<string, string> = {
  jajka: "jajecznica i omlety",
  nalesniki: "naleśniki i placki",
  owsianki: "owsianki",
  kanapki: "kanapki",
  wrapy: "tortille i wrapy",
  zupy: "zupy",
  jednogarnkowe: "dania jednogarnkowe",
  miesoZDodatkiem: "mięso z dodatkami",
  makarony: "makarony",
  kluski: "pierogi i kluski",
  salatki: "sałatki",
  koktajle: "koktajle",
  wypieki: "wypieki i zapiekanki",
  przekaski: "przekąski",
};

const DLUGOSCI_PLANU = [
  { dni: 1, label: "Na dziś", opis: "jeden dzień" },
  { dni: 3, label: "Na 3 dni", opis: "np. początek tygodnia" },
  { dni: 7, label: "Na tydzień", opis: "z pełną listą zakupów" },
];

function pobierzPDF(sekcja: "plan" | "lista") {
  const klasa = sekcja === "plan" ? "drukuj-plan" : "drukuj-lista";
  document.body.classList.add(klasa);
  window.print();
  document.body.classList.remove(klasa);
}

function zsumujMakroDnia(posilki: PosilekWPlanie[]) {
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

export default function Home() {
  const [wczytano, setWczytano] = useState(false);
  const [profil, setProfil] = useState<Profil | null>(null);
  const [plan, setPlan] = useState<WygenerowanyPlan | null>(null);
  /** Świeżo wygenerowany plan, którego user jeszcze nie zaakceptował. */
  const [podglad, setPodglad] = useState<WygenerowanyPlan | null>(null);
  const [zjedzone, setZjedzone] = useState<string[]>([]);
  const [kupione, setKupione] = useState<string[]>([]);
  const [historiaWagi, setHistoriaWagi] = useState<{ data: string; waga: number }[]>([]);
  const [widok, setWidok] = useState<Widok>("menu");
  const [generuje, setGeneruje] = useState(false);
  const [pracuje, setPracuje] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);
  const [pytajOWage, setPytajOWage] = useState(false);
  const [nowaWaga, setNowaWaga] = useState<number | "">("");
  /** Otwarty modal wymiany: który posiłek i co proponujemy w zamian. */
  const [wymiana, setWymiana] = useState<{ dzien: number; indeks: number; propozycje: PosilekWPlanie[] } | null>(null);
  /** Na ile dni user układa plan ręcznie (tryb „ułożę sam"). */
  const [dniRecznie, setDniRecznie] = useState(1);

  // Dane usera leżą w przeglądarce, więc czytamy je dopiero po stronie klienta.
  useEffect(() => {
    setProfil(magazyn.wczytajProfil());
    const zapisany = magazyn.wczytajPlan();
    if (zapisany) {
      setPlan(zapisany);
      setZjedzone(magazyn.wczytajPostep().zjedzone);
      setKupione(magazyn.wczytajZakupy());
    }
    setHistoriaWagi(magazyn.wczytajWage());
    setPytajOWage(magazyn.czyPytacOWage());
    setWczytano(true);
  }, []);

  function zapiszProfil(nowy: Profil) {
    magazyn.zapiszProfil(nowy);
    setProfil(nowy);
  }

  /** Wspólne ciało zapytań do silnika — profil jest jedynym źródłem preferencji. */
  function daneZProfilu(p: Profil) {
    const daneKompletne =
      p.dane?.waga &&
      p.dane?.wzrost &&
      p.dane?.wiek &&
      p.dane?.plec &&
      p.dane?.aktywnoscPraca &&
      p.dane?.aktywnoscPozaPraca &&
      p.dane?.cel;
    return {
      kcalDzienne: p.kcalDzienne,
      // Profil trzyma dane z opcjonalnymi polami (user może wypełnić część); kompletność
      // sprawdzamy wyżej, więc tutaj zawężamy typ jawnie.
      dane: !p.kcalDzienne && daneKompletne ? (p.dane as DaneAntropometryczne) : undefined,
      makro: p.makro,
      sloty: SLOTY_DLA_LICZBY[p.liczbaPosilkow],
      smakPerSlot: p.smakPerSlot,
      restrykcje: p.restrykcje,
      lubianeSkladniki: p.lubianeSkladniki,
      nielubianeSkladniki: p.nielubianeSkladniki,
      bezSprzetu: p.bezSprzetu,
      stylGotowania: p.stylGotowania,
      ulubioneRodzaje: p.ulubioneRodzaje ?? [],
    };
  }

  async function generuj(liczbaDni: number) {
    if (!profil) return;
    setGeneruje(true);
    setBlad(null);
    try {
      const odpowiedz = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Data startu mówi silnikowi, które dni planu wypadają w weekend — tam trafiają
        // dania wymagające dłuższego gotowania.
        body: JSON.stringify({
          ...daneZProfilu(profil),
          liczbaDni,
          dataStartu: new Date().toISOString().slice(0, 10),
        }),
      });
      const wynik = await odpowiedz.json();
      if (!odpowiedz.ok) throw new Error(wynik.blad ?? "Nie udało się ułożyć planu");
      setPodglad(wynik);
      setWidok("podglad");
    } catch (e) {
      setBlad(e instanceof Error ? e.message : "Nieznany błąd");
    } finally {
      setGeneruje(false);
    }
  }

  function akceptujPlan() {
    if (!podglad) return;
    magazyn.zapiszPlan(podglad);
    magazyn.zapiszPostep({ zjedzone: [] });
    magazyn.zapiszZakupy([]);
    setPlan(podglad);
    setZjedzone([]);
    setKupione([]);
    setPodglad(null);
    setWidok("menu");
  }

  /** Który plan jest w danej chwili edytowany: podgląd przed akceptacją albo ten zapisany. */
  const edytowany = podglad ?? plan;

  function podmienWPlanie(indeksDnia: number, indeksPosilku: number, nowy: PosilekWPlanie) {
    if (!edytowany) return;
    const dni: DzienWPlanie[] = edytowany.dni.map((dzien, i) => {
      if (i !== indeksDnia) return dzien;
      const posilki = dzien.posilki.map((p, j) => (j === indeksPosilku ? nowy : p));
      return { ...dzien, posilki, makroDnia: zsumujMakroDnia(posilki) };
    });
    const zaktualizowany = { ...edytowany, dni, listaZakupow: zbudujListeZakupow(dni) };
    if (podglad) {
      setPodglad(zaktualizowany);
    } else {
      setPlan(zaktualizowany);
      magazyn.zapiszPlan(zaktualizowany);
    }
  }

  async function pokazPropozycje(indeksDnia: number, indeksPosilku: number) {
    if (!profil || !edytowany) return;
    const posilek = edytowany.dni[indeksDnia].posilki[indeksPosilku];
    // Modal otwieramy OD RAZU, z pustą listą i spinnerem. Wcześniej czekał na odpowiedź
    // (2-3 s, a przy pierwszym wywołaniu w dev nawet 14 s) i wyglądało to jak zepsuty przycisk.
    setWymiana({ dzien: indeksDnia, indeks: indeksPosilku, propozycje: [] });
    setPracuje(true);
    setBlad(null);
    try {
      const odpowiedz = await fetch("/api/plan/wymien", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...daneZProfilu(profil),
          slot: posilek.slot,
          wyklucz: [posilek.recipeId.replace(/^szablon:/, ""), posilek.recipeId],
        }),
      });
      const wynik = await odpowiedz.json();
      if (!odpowiedz.ok) throw new Error(wynik.blad ?? "Nie udało się znaleźć zamiennika");
      setWymiana({ dzien: indeksDnia, indeks: indeksPosilku, propozycje: wynik.propozycje });
    } catch (e) {
      setBlad(e instanceof Error ? e.message : "Nieznany błąd");
      setWymiana(null);
    } finally {
      setPracuje(false);
    }
  }

  function odhacz(klucz: string) {
    const nowe = [...zjedzone, klucz];
    setZjedzone(nowe);
    magazyn.zapiszPostep({ zjedzone: nowe });
  }

  function cofnij(klucz: string) {
    const nowe = zjedzone.filter((k) => k !== klucz);
    setZjedzone(nowe);
    magazyn.zapiszPostep({ zjedzone: nowe });
  }

  function przelaczZakup(skladnikId: string) {
    const nowe = kupione.includes(skladnikId) ? kupione.filter((x) => x !== skladnikId) : [...kupione, skladnikId];
    setKupione(nowe);
    magazyn.zapiszZakupy(nowe);
  }

  function zapiszWage() {
    if (typeof nowaWaga !== "number" || nowaWaga <= 0 || !profil) return;
    setHistoriaWagi(magazyn.dopiszWage(nowaWaga));
    zapiszProfil({ ...profil, dane: { ...profil.dane, waga: nowaWaga } });
    setPytajOWage(false);
    setNowaWaga("");
  }

  if (!wczytano) {
    return (
      <main className="wrapper">
        <div className="panel">
          <p className="podtytul">Wczytuję…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="wrapper">
      <div className="panel">
        <h1 className="tytul">dietetyq</h1>

        {!profil ? (
          <Onboarding onGotowe={zapiszProfil} />
        ) : (
          <>
            {pytajOWage && (
              <div className="waga-pytanie nie-do-druku">
                <span>Cześć {profil.nick}! Ile dziś ważysz?</span>
                <input
                  className="kreator-ilosc"
                  type="number"
                  value={nowaWaga}
                  onChange={(e) => setNowaWaga(e.target.value === "" ? "" : Number(e.target.value))}
                />
                <button className="btn-maly" onClick={zapiszWage}>
                  Zapisz
                </button>
                <button className="btn-maly" onClick={() => setPytajOWage(false)}>
                  Nie dziś
                </button>
              </div>
            )}

            {blad && <div className="blad">{blad}</div>}

            {generuje && (
              <div className="ladowanie">
                <div className="spinner" />
                <p className="podtytul">Układam plan…</p>
              </div>
            )}

            {!generuje && widok === "menu" && (
              <>
                <h2>Cześć, {profil.nick}!</h2>
                {plan ? (
                  <>
                    <p className="podtytul">
                      Masz plan na {plan.dni.length} {plan.dni.length === 1 ? "dzień" : "dni"} · zjedzone{" "}
                      {zjedzone.length} z {plan.dni.reduce((s, d) => s + d.posilki.length, 0)} posiłków.
                    </p>
                    <div className="siatka-wyboru">
                      <button className="kafelek wybrany" onClick={() => setWidok("plan")}>
                        <span className="emoji">🍽️</span>
                        Mój plan
                        <span className="posilek-makro">co jeść teraz</span>
                      </button>
                      <button className="kafelek" onClick={() => setWidok("zakupy")}>
                        <span className="emoji">🛒</span>
                        Lista zakupów
                      </button>
                      <button className="kafelek" onClick={() => setWidok("profil")}>
                        <span className="emoji">⚙️</span>
                        Moje ustawienia
                      </button>
                    </div>
                    <h2 style={{ marginTop: 28 }}>Nowy plan?</h2>
                    <p className="podtytul" style={{ marginBottom: 12 }}>
                      Obecny zniknie razem z postępem i odhaczoną listą zakupów.
                    </p>
                  </>
                ) : (
                  <p className="podtytul">Nie masz jeszcze planu. Na ile dni go ułożyć?</p>
                )}

                <div className="siatka-wyboru">
                  {DLUGOSCI_PLANU.map((d) => (
                    <button key={d.dni} className="kafelek" onClick={() => generuj(d.dni)}>
                      <span className="emoji">{d.dni}</span>
                      {d.label}
                      <span className="posilek-makro">{d.opis}</span>
                    </button>
                  ))}
                </div>

                <h2 style={{ marginTop: 28 }}>Wolisz wybrać sam?</h2>
                <p className="podtytul" style={{ marginBottom: 12 }}>
                  Wtedy każdy posiłek wybierasz z bazy albo składasz ze składników. Możesz też
                  poprosić o dobranie pojedynczych slotów.
                </p>
                <div className="siatka-wyboru">
                  {DLUGOSCI_PLANU.map((d) => (
                    <button
                      key={d.dni}
                      className="kafelek"
                      onClick={() => {
                        setDniRecznie(d.dni);
                        setWidok("ulozSam");
                      }}
                    >
                      <span className="emoji">✍️</span>
                      Ułożę sam na {d.dni}{" "}
                      {d.dni === 1 ? "dzień" : "dni"}
                    </button>
                  ))}
                </div>
              </>
            )}

            {!generuje && widok === "plan" && plan && (
              <MojPlan
                plan={plan}
                profil={profil}
                zjedzone={zjedzone}
                onZjedzone={odhacz}
                onCofnij={cofnij}
                onWymien={pokazPropozycje}
                onPokazCalyPlan={() => setWidok("calyPlan")}
                onListaZakupow={() => setWidok("zakupy")}
                onMenu={() => setWidok("menu")}
                pracuje={pracuje}
              />
            )}

            {!generuje && widok === "zakupy" && plan && (
              <ListaZakupow
                pozycje={plan.listaZakupow}
                kupione={kupione}
                liczbaOsob={profil.liczbaOsob}
                onPrzelacz={przelaczZakup}
                onWyczysc={() => {
                  setKupione([]);
                  magazyn.zapiszZakupy([]);
                }}
                onPDF={() => pobierzPDF("lista")}
                onWroc={() => setWidok(plan ? "plan" : "menu")}
              />
            )}

            {!generuje && (widok === "podglad" || widok === "calyPlan") && edytowany && (
              <>
                <h2>{widok === "podglad" ? "Twój nowy plan" : "Cały plan"}</h2>
                <p className="podtytul">
                  Orientacyjnie {Math.round(edytowany.kcalDzienne)} kcal dziennie · B:{" "}
                  {Math.round(edytowany.makroDzienne.bialko)}g · T: {Math.round(edytowany.makroDzienne.tluszcz)}g · W:{" "}
                  {Math.round(edytowany.makroDzienne.wegle)}g. To widełki, nie normy do wyrobienia.
                </p>

                {edytowany.ostrzezenia?.map((tekst, i) => (
                  <div key={i} className="kreator-ostrzezenie">
                    ⚠ {tekst}
                  </div>
                ))}

                <div id="sekcja-plan-druk">
                  {edytowany.dni.map((dzien, indeksDnia) => (
                    <div key={dzien.dzien} className="dzien-karta">
                      <div className="dzien-naglowek">
                        <h3>{edytowany.dni.length === 1 ? "Twój dzień" : `Dzień ${dzien.dzien}`}</h3>
                        <span className="podtytul">{Math.round(dzien.makroDnia.kcal)} kcal</span>
                      </div>
                      {dzien.posilki.map((posilek, i) => {
                        const zjedzony = zjedzone.includes(kluczPosilku(dzien.dzien, i));
                        return (
                          <div key={i} className={`posilek ${zjedzony ? "posilek-zjedzony" : ""}`}>
                            <div className="posilek-nazwa">
                              {NAZWY_SLOTOW[posilek.slot] ?? posilek.slot}: {posilek.nazwa}
                              {posilek.gotowiec && (
                                <span className="znacznik znacznik-baza">
                                  {posilek.bezGotowania ? "bez gotowania" : "składane"}
                                </span>
                              )}
                              {zjedzony && <span className="znacznik znacznik-uwaga">zjedzone</span>}
                            </div>
                            <div className="posilek-makro">
                              {Math.round(posilek.makro.kcal)} kcal · B: {Math.round(posilek.makro.bialko)}g · T:{" "}
                              {Math.round(posilek.makro.tluszcz)}g · W: {Math.round(posilek.makro.wegle)}g
                            </div>
                            {posilek.dosypki?.map((d, j) => (
                              <div key={j} className="dosypka">
                                ➕ Do tego: <strong>{d.opis}</strong>
                              </div>
                            ))}
                            <div className="posilek-akcje nie-do-druku">
                              <button
                                className="btn-maly"
                                disabled={pracuje}
                                onClick={() => pokazPropozycje(indeksDnia, i)}
                              >
                                🔄 Wymień
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>

                <h2>Bilans mikroskładników</h2>
                <BilansMikro
                  dni={edytowany.dni.map((d) => d.posilki.flatMap((p) => p.skladnikiBazowe))}
                  plec={profil.dane?.plec}
                />

                <div className="menu-akcje nie-do-druku">
                  <button className="btn-maly" onClick={() => pobierzPDF("plan")}>
                    📄 Pobierz PDF
                  </button>
                </div>

                <div className="przyciski-nawigacji">
                  {widok === "podglad" ? (
                    <>
                      <button
                        className="btn btn-wstecz"
                        onClick={() => {
                          setPodglad(null);
                          setWidok("menu");
                        }}
                      >
                        Odrzuć
                      </button>
                      <button className="btn btn-dalej" onClick={akceptujPlan}>
                        ✓ Biorę ten plan
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-wstecz" onClick={() => setWidok("plan")}>
                      ← Wróć
                    </button>
                  )}
                </div>
              </>
            )}

            {!generuje && widok === "ulozSam" && (() => {
              const dane = daneZProfilu(profil);
              const { kcalDzienne, makroDzienne, celeSlotow } = celeSlotowDla(dane);
              return (
                <UlozSam
                  profil={profil}
                  liczbaDni={dniRecznie}
                  celeSlotow={celeSlotow}
                  kcalDzienne={kcalDzienne}
                  makroDzienne={makroDzienne}
                  daneZapytania={dane}
                  onAnuluj={() => setWidok("menu")}
                  onZapisz={(nowy) => {
                    setPodglad(nowy);
                    setWidok("podglad");
                  }}
                />
              );
            })()}

            {!generuje && widok === "profil" && (
              <>
                <h2>Moje ustawienia</h2>
                <p className="podtytul">
                  {profil.nick} · {profil.liczbaPosilkow} posiłki dziennie ·{" "}
                  {profil.kcalDzienne ? `${profil.kcalDzienne} kcal` : "kcal liczone z danych"} · gotowanie:{" "}
                  {profil.stylGotowania}
                  {profil.liczbaOsob > 1 && ` · gotujesz dla ${profil.liczbaOsob} osób`}
                  {profil.bezSprzetu.length > 0 && ` · nie masz: ${profil.bezSprzetu.join(", ")}`}
                  {profil.restrykcje.length > 0 && ` · nie jesz: ${profil.restrykcje.join(", ")}`}
                  {(profil.ulubioneRodzaje?.length ?? 0) > 0 &&
                    ` · lubisz: ${profil.ulubioneRodzaje.map((r) => ETYKIETY_RODZAJOW[r] ?? r).join(", ")}`}
                </p>

                {historiaWagi.length > 0 && (
                  <>
                    <h2 style={{ marginTop: 24 }}>Waga</h2>
                    <div className="lista-zakupow">
                      {historiaWagi.slice(-7).map((w) => (
                        <div key={w.data} className="lista-zakupow-pozycja">
                          {w.data}: {w.waga} kg
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="menu-akcje">
                  <button
                    className="btn-maly"
                    onClick={() => {
                      if (confirm("Wypełnić ankietę od nowa? Plan i postęp zostaną skasowane.")) {
                        magazyn.wyczysc();
                        setProfil(null);
                        setPlan(null);
                        setZjedzone([]);
                        setKupione([]);
                        setHistoriaWagi([]);
                        setWidok("menu");
                      }
                    }}
                  >
                    Ustaw wszystko od nowa
                  </button>
                </div>

                <div className="przyciski-nawigacji">
                  <button className="btn btn-wstecz" onClick={() => setWidok("menu")}>
                    ← Menu
                  </button>
                </div>
              </>
            )}

            {wymiana && (
              <ModalWymiany
                slot={edytowany?.dni[wymiana.dzien].posilki[wymiana.indeks].slot ?? ""}
                propozycje={wymiana.propozycje}
                liczbaOsob={profil.liczbaOsob}
                pracuje={pracuje}
                onLosujPonownie={() => pokazPropozycje(wymiana.dzien, wymiana.indeks)}
                onWybierz={(p) => {
                  podmienWPlanie(wymiana.dzien, wymiana.indeks, p);
                  setWymiana(null);
                }}
                onAnuluj={() => setWymiana(null)}
              />
            )}
          </>
        )}
      </div>
    </main>
  );
}
