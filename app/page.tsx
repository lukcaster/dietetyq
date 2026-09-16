"use client";

import { useEffect, useState } from "react";
import BilansMikro from "./BilansMikro";
import KoszykLodowki from "./KoszykLodowki";
import KreatorPosilku from "./KreatorPosilku";
import { zbudujListeZakupow } from "@/lib/engine/lista-zakupow";
import type { DzienWPlanie, PosilekWPlanie, WygenerowanyPlan } from "@/lib/engine/planner";

const KCAL_PRESETY = [1800, 2000, 2200, 2500, 3000];

const PLEC_OPCJE = [
  { id: "K", label: "Kobieta" },
  { id: "M", label: "Mężczyzna" },
] as const;

const AKTYWNOSC_PRACA_OPCJE = [
  { id: 1, label: "Siedząca", opis: "praca biurowa, siedzisz" },
  { id: 2, label: "Lekka", opis: "trochę stania i siedzenia" },
  { id: 3, label: "Umiarkowana", opis: "np. dźwiganie, ruch" },
  { id: 4, label: "Ciężka fizyczna", opis: "intensywny wysiłek" },
] as const;

const AKTYWNOSC_POZA_PRACA_OPCJE = [
  { id: "A", label: "Brak", opis: "do 10 min dziennie" },
  { id: "B", label: "Niewielka", opis: "~20 min, czasem spacer" },
  { id: "C", label: "Spacer/bieg", opis: "~30 min dziennie" },
  { id: "D", label: "Umiarkowana", opis: "~40 min dziennie" },
  { id: "E", label: "Dość wysoka", opis: "do 60 min dziennie" },
  { id: "F", label: "Bardzo duża", opis: "ponad godzinę dziennie" },
] as const;

interface RozkladMakro {
  bialko: number;
  tluszcz: number;
  wegle: number;
}

/** Domyślnie 30/35/35 — to samo, co DOMYSLNY_ROZKLAD_MAKRO w silniku. */
const MAKRO_DOMYSLNE: RozkladMakro = { bialko: 30, tluszcz: 35, wegle: 35 };

const MAKRO_PRESETY: { label: string; opis: string; makro: RozkladMakro }[] = [
  { label: "Zbilansowane", opis: "30 / 35 / 35", makro: MAKRO_DOMYSLNE },
  { label: "Wysokobiałkowe", opis: "40 / 30 / 30", makro: { bialko: 40, tluszcz: 30, wegle: 30 } },
  { label: "Mniej tłuszczu", opis: "30 / 20 / 50", makro: { bialko: 30, tluszcz: 20, wegle: 50 } },
  { label: "Więcej węgli", opis: "25 / 25 / 50", makro: { bialko: 25, tluszcz: 25, wegle: 50 } },
];

const MAKRO_POLA: { klucz: keyof RozkladMakro; label: string; kcalNaGram: number }[] = [
  { klucz: "bialko", label: "Białko", kcalNaGram: 4 },
  { klucz: "tluszcz", label: "Tłuszcz", kcalNaGram: 9 },
  { klucz: "wegle", label: "Węgle", kcalNaGram: 4 },
];

const CEL_OPCJE = [
  { id: "redukcja", label: "Redukcja" },
  { id: "utrzymanie", label: "Utrzymanie" },
  { id: "masa", label: "Masa" },
] as const;

interface DaneFormularz {
  waga: number | "";
  wzrost: number | "";
  wiek: number | "";
  plec: "K" | "M" | "";
  aktywnoscPraca: 1 | 2 | 3 | 4 | "";
  aktywnoscPozaPraca: "A" | "B" | "C" | "D" | "E" | "F" | "";
  cel: "redukcja" | "utrzymanie" | "masa" | "";
}

const PUSTE_DANE: DaneFormularz = {
  waga: "",
  wzrost: "",
  wiek: "",
  plec: "",
  aktywnoscPraca: "",
  aktywnoscPozaPraca: "",
  cel: "",
};

function makroRowne(a: RozkladMakro, b: RozkladMakro): boolean {
  return a.bialko === b.bialko && a.tluszcz === b.tluszcz && a.wegle === b.wegle;
}

/** Formularz trzyma "" dla pól niewypełnionych; silnik chce kompletu — stąd type guard. */
type DaneKompletne = { [K in keyof DaneFormularz]: Exclude<DaneFormularz[K], ""> };

function danePelne(d: DaneFormularz): d is DaneKompletne {
  return (
    d.waga !== "" &&
    d.wzrost !== "" &&
    d.wiek !== "" &&
    d.plec !== "" &&
    d.aktywnoscPraca !== "" &&
    d.aktywnoscPozaPraca !== "" &&
    d.cel !== ""
  );
}

/**
 * Rozkład dnia zależy wyłącznie od LICZBY posiłków — user nie składa go sobie sam.
 *
 * Wcześniej można było wyklikać dowolny zestaw slotów i charakter każdego z nich („drugie
 * śniadanie wytrawne"), i to był główny powód, dla którego plan tygodniowy się powtarzał:
 * przy wytrawnym drugim śniadaniu w bazie jest dokładnie jeden pasujący przepis, więc
 * wypadał siedem razy. Trzy sensowne układy dnia dają lepsze plany niż pełna swoboda.
 */
const UKLADY_DNIA = [
  { liczba: 3, sloty: ["sniadanie", "obiad", "kolacja"], opis: "śniadanie, obiad, kolacja" },
  {
    liczba: 4,
    sloty: ["sniadanie", "drugie-sniadanie", "obiad", "kolacja"],
    opis: "+ drugie śniadanie",
  },
  {
    liczba: 5,
    sloty: ["sniadanie", "drugie-sniadanie", "obiad", "podwieczorek", "kolacja"],
    opis: "+ przekąska przed kolacją",
  },
] as const;

const NAZWY_SLOTOW: Record<string, string> = {
  sniadanie: "🌅 Śniadanie",
  "drugie-sniadanie": "🥪 II śniadanie",
  obiad: "🍽️ Obiad",
  podwieczorek: "🍓 Podwieczorek",
  kolacja: "🌙 Kolacja",
};

const RESTRYKCJE_OPCJE = [
  { id: "laktoza", label: "Laktoza", emoji: "🥛" },
  { id: "gluten", label: "Gluten", emoji: "🌾" },
  { id: "orzechy", label: "Orzechy", emoji: "🥜" },
  { id: "jajka", label: "Jajka", emoji: "🥚" },
];

/** Trzystanowy przełącznik chipsa: neutralnie → lubię → nie lubię → neutralnie. */
type Preferencja = "lubie" | "nie-lubie";

interface GrupaSkladnikow {
  grupa: string;
  skladniki: { id: string; nazwa: string }[];
}

const KROKI = [1, 2, 3, 4, 5, 6] as const;
type Krok = (typeof KROKI)[number];

/**
 * Dwie ścieżki na ten sam cel. Kroki 1-2 (kcal/makro, sloty) są wspólne, dalej się rozjeżdżają:
 * "przepisy" dobiera dania z bazy na 7 dni, "lodowka" rozpisuje jeden dzień z tego, co user ma.
 */
type Tryb = "przepisy" | "lodowka";

const TRYB_OPCJE: { id: Tryb; emoji: string; label: string; opis: string }[] = [
  {
    id: "przepisy",
    emoji: "📖",
    label: "Dobierz mi przepisy",
    opis: "Plan na 7 dni z gotowymi przepisami i listą zakupów.",
  },
  {
    id: "lodowka",
    emoji: "🧊",
    label: "Mam składniki, rozpisz mi to",
    opis: "Mówisz, co masz w lodówce — dostajesz jeden dzień z gramaturami. Bez przepisów.",
  },
];

/** Który posiłek planu jest właśnie przebudowywany w kreatorze. */
interface KreatorDla {
  dzien: number;
  indeks: number;
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

function pobierzPDF(sekcja: "plan" | "lista") {
  const klasa = sekcja === "plan" ? "drukuj-plan" : "drukuj-lista";
  document.body.classList.add(klasa);
  window.print();
  document.body.classList.remove(klasa);
}

export default function Home() {
  const [tryb, setTryb] = useState<Tryb | null>(null);
  const [krok, setKrok] = useState<Krok>(1);
  const [trybKcal, setTrybKcal] = useState<"wprost" | "wyliczone">("wprost");
  const [kcal, setKcal] = useState<number | "">("");
  const [dane, setDane] = useState<DaneFormularz>(PUSTE_DANE);
  const [makro, setMakro] = useState<RozkladMakro>(MAKRO_DOMYSLNE);
  const [liczbaPosilkow, setLiczbaPosilkow] = useState<3 | 4 | 5>(3);
  const sloty = UKLADY_DNIA.find((u) => u.liczba === liczbaPosilkow)!.sloty as unknown as string[];
  const [restrykcje, setRestrykcje] = useState<string[]>([]);
  const [preferencje, setPreferencje] = useState<Record<string, Preferencja>>({});
  const [grupySkladnikow, setGrupySkladnikow] = useState<GrupaSkladnikow[]>([]);
  const [plan, setPlan] = useState<WygenerowanyPlan | null>(null);
  const [kreatorDla, setKreatorDla] = useState<KreatorDla | null>(null);
  const [ladowanie, setLadowanie] = useState(false);
  const [blad, setBlad] = useState<string | null>(null);

  /**
   * Podmiana pojedynczego posiłku nie regeneruje planu — przeliczamy tylko makro tego dnia
   * i listę zakupów (liczoną z gotowych dni, patrz lib/engine/lista-zakupow.ts).
   */
  function podmienPosilek(nowy: PosilekWPlanie) {
    if (!plan || !kreatorDla) return;
    const dni: DzienWPlanie[] = plan.dni.map((dzien, indeksDnia) => {
      if (indeksDnia !== kreatorDla.dzien) return dzien;
      const posilki = dzien.posilki.map((p, i) => (i === kreatorDla.indeks ? nowy : p));
      return { ...dzien, posilki, makroDnia: zsumujMakroDnia(posilki) };
    });
    setPlan({ ...plan, dni, listaZakupow: zbudujListeZakupow(dni) });
    setKreatorDla(null);
  }

  const sumaMakro = makro.bialko + makro.tluszcz + makro.wegle;
  // W trybie "wylicz dla mnie" kcal zna dopiero silnik, więc gramy pokazujemy tylko przy kcal wpisanych wprost.
  const kcalDoPodgladu = trybKcal === "wprost" && typeof kcal === "number" ? kcal : 0;

  function przelaczRestrykcje(id: string) {
    setRestrykcje((aktualne) => (aktualne.includes(id) ? aktualne.filter((s) => s !== id) : [...aktualne, id]));
  }

  function przelaczPreferencje(id: string) {
    setPreferencje((aktualne) => {
      const { [id]: obecna, ...reszta } = aktualne;
      if (obecna === undefined) return { ...reszta, [id]: "lubie" };
      if (obecna === "lubie") return { ...reszta, [id]: "nie-lubie" };
      return reszta;
    });
  }

  const lubiane = Object.keys(preferencje).filter((id) => preferencje[id] === "lubie");
  const nielubiane = Object.keys(preferencje).filter((id) => preferencje[id] === "nie-lubie");

  // Listę składników do wyboru trzyma serwer (ingredients.json), żeby UI nie miał drugiej kopii bazy.
  useEffect(() => {
    if (krok !== 4 || grupySkladnikow.length > 0) return;
    fetch("/api/skladniki")
      .then((o) => o.json())
      .then((wynik) => setGrupySkladnikow(wynik.grupy ?? []))
      .catch(() => setBlad("Nie udało się wczytać listy składników"));
  }, [krok, grupySkladnikow.length]);

  async function generujPlan() {
    setLadowanie(true);
    setBlad(null);
    try {
      const wspolne = {
        makro,
        sloty,
        restrykcje,
        lubianeSkladniki: lubiane,
        nielubianeSkladniki: nielubiane,
      };
      const body =
        trybKcal === "wprost"
          ? { kcalDzienne: kcal, ...wspolne }
          : {
              dane: { ...dane, waga: Number(dane.waga), wzrost: Number(dane.wzrost), wiek: Number(dane.wiek) },
              ...wspolne,
            };
      const odpowiedz = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const wynik = await odpowiedz.json();
      if (!odpowiedz.ok) throw new Error(wynik.blad ?? "Nie udało się wygenerować planu");
      setPlan(wynik);
      setKrok(5);
    } catch (e) {
      setBlad(e instanceof Error ? e.message : "Nieznany błąd");
    } finally {
      setLadowanie(false);
    }
  }

  return (
    <div className="wrapper">
      <h1 className="tytul">Dietetyq</h1>
      <p className="podtytul">
        {tryb === "lodowka" ? "Jeden dzień z tego, co masz pod ręką." : "Twój plan jedzenia na tydzień."}
      </p>

      {tryb && (
        <div className="krok-licznik nie-do-druku">
          {(tryb === "lodowka" ? KROKI.slice(0, 3) : KROKI).map((n) => (
            <div key={n} className={`krok-kropka ${krok >= n ? "aktywna" : ""}`} />
          ))}
        </div>
      )}

      <div className="panel">
        {!tryb && (
          <>
            <h2>Od czego zaczynamy?</h2>
            <div className="siatka-wyboru" style={{ gridTemplateColumns: "1fr 1fr" }}>
              {TRYB_OPCJE.map((opcja) => (
                <button
                  key={opcja.id}
                  className="kafelek"
                  onClick={() => {
                    setTryb(opcja.id);
                    setKrok(1);
                  }}
                >
                  <span className="emoji">{opcja.emoji}</span>
                  {opcja.label}
                  <div className="posilek-makro">{opcja.opis}</div>
                </button>
              ))}
            </div>
          </>
        )}

        {tryb && krok === 1 && (
          <>
            <h2>Ile kcal dziennie chcesz jeść?</h2>
            <div className="siatka-wyboru" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <button
                className={`kafelek ${trybKcal === "wprost" ? "wybrany" : ""}`}
                onClick={() => setTrybKcal("wprost")}
              >
                Wpiszę sam
              </button>
              <button
                className={`kafelek ${trybKcal === "wyliczone" ? "wybrany" : ""}`}
                onClick={() => setTrybKcal("wyliczone")}
              >
                Wylicz dla mnie
              </button>
            </div>

            {trybKcal === "wprost" && (
              <>
                <input
                  className="kcal-input"
                  type="number"
                  inputMode="numeric"
                  placeholder="np. 2200"
                  value={kcal}
                  onChange={(e) => setKcal(e.target.value === "" ? "" : Number(e.target.value))}
                />
                <div className="presety">
                  {KCAL_PRESETY.map((p) => (
                    <button key={p} className={`preset-btn ${kcal === p ? "wybrany" : ""}`} onClick={() => setKcal(p)}>
                      {p} kcal
                    </button>
                  ))}
                </div>
              </>
            )}

            {trybKcal === "wyliczone" && (
              <>
                <div className="siatka-wyboru" style={{ gridTemplateColumns: "1fr 1fr 1fr", marginTop: 20 }}>
                  <input
                    className="kcal-input"
                    style={{ fontSize: "1.4rem" }}
                    type="number"
                    placeholder="Waga (kg)"
                    value={dane.waga}
                    onChange={(e) => setDane({ ...dane, waga: e.target.value === "" ? "" : Number(e.target.value) })}
                  />
                  <input
                    className="kcal-input"
                    style={{ fontSize: "1.4rem" }}
                    type="number"
                    placeholder="Wzrost (cm)"
                    value={dane.wzrost}
                    onChange={(e) => setDane({ ...dane, wzrost: e.target.value === "" ? "" : Number(e.target.value) })}
                  />
                  <input
                    className="kcal-input"
                    style={{ fontSize: "1.4rem" }}
                    type="number"
                    placeholder="Wiek"
                    value={dane.wiek}
                    onChange={(e) => setDane({ ...dane, wiek: e.target.value === "" ? "" : Number(e.target.value) })}
                  />
                </div>

                <p className="podtytul">Płeć</p>
                <div className="siatka-wyboru" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  {PLEC_OPCJE.map((opcja) => (
                    <button
                      key={opcja.id}
                      className={`kafelek ${dane.plec === opcja.id ? "wybrany" : ""}`}
                      onClick={() => setDane({ ...dane, plec: opcja.id })}
                    >
                      {opcja.label}
                    </button>
                  ))}
                </div>

                <p className="podtytul">Aktywność w pracy</p>
                <div className="siatka-wyboru" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  {AKTYWNOSC_PRACA_OPCJE.map((opcja) => (
                    <button
                      key={opcja.id}
                      className={`kafelek ${dane.aktywnoscPraca === opcja.id ? "wybrany" : ""}`}
                      onClick={() => setDane({ ...dane, aktywnoscPraca: opcja.id })}
                    >
                      {opcja.label}
                      <div className="posilek-makro">{opcja.opis}</div>
                    </button>
                  ))}
                </div>

                <p className="podtytul">Wysiłek fizyczny poza pracą</p>
                <div className="siatka-wyboru" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                  {AKTYWNOSC_POZA_PRACA_OPCJE.map((opcja) => (
                    <button
                      key={opcja.id}
                      className={`kafelek ${dane.aktywnoscPozaPraca === opcja.id ? "wybrany" : ""}`}
                      onClick={() => setDane({ ...dane, aktywnoscPozaPraca: opcja.id })}
                    >
                      {opcja.label}
                      <div className="posilek-makro">{opcja.opis}</div>
                    </button>
                  ))}
                </div>

                <p className="podtytul">Cel</p>
                <div className="siatka-wyboru" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
                  {CEL_OPCJE.map((opcja) => (
                    <button
                      key={opcja.id}
                      className={`kafelek ${dane.cel === opcja.id ? "wybrany" : ""}`}
                      onClick={() => setDane({ ...dane, cel: opcja.id })}
                    >
                      {opcja.label}
                    </button>
                  ))}
                </div>
              </>
            )}

            <h2 style={{ marginTop: 32 }}>Rozkład makro</h2>
            <p className="podtytul" style={{ marginBottom: 12 }}>
              To procent <strong>kalorii</strong>, nie gramów — gramy wychodzą z podziału przez 4 kcal/g (białko,
              węgle) i 9 kcal/g (tłuszcz).
            </p>

            <div className="presety">
              {MAKRO_PRESETY.map((preset) => (
                <button
                  key={preset.label}
                  className={`preset-btn ${sumaMakro === 100 && makroRowne(makro, preset.makro) ? "wybrany" : ""}`}
                  onClick={() => setMakro(preset.makro)}
                >
                  {preset.label} <span className="podtytul">{preset.opis}</span>
                </button>
              ))}
            </div>

            <div className="makro-siatka">
              {MAKRO_POLA.map(({ klucz, label, kcalNaGram }) => (
                <label key={klucz} className="makro-pole">
                  <span className="makro-etykieta">{label}</span>
                  <div className="makro-wejscie">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={makro[klucz]}
                      onChange={(e) =>
                        setMakro({ ...makro, [klucz]: e.target.value === "" ? 0 : Number(e.target.value) })
                      }
                    />
                    <span className="makro-procent">%</span>
                  </div>
                  <span className="posilek-makro">
                    {kcalDoPodgladu > 0
                      ? `${Math.round((kcalDoPodgladu * makro[klucz]) / 100 / kcalNaGram)} g dziennie`
                      : `${kcalNaGram} kcal/g`}
                  </span>
                </label>
              ))}
            </div>

            <p className={`makro-suma ${sumaMakro === 100 ? "ok" : "zle"}`}>
              Razem: {sumaMakro}%{sumaMakro !== 100 && " — musi wyjść 100%"}
            </p>

            <div className="przyciski-nawigacji">
              <button className="btn btn-wstecz" onClick={() => setTryb(null)}>
                Wstecz
              </button>
              <button
                className="btn btn-dalej"
                disabled={
                  sumaMakro !== 100 || (trybKcal === "wprost" ? !kcal || kcal <= 0 : !danePelne(dane))
                }
                onClick={() => setKrok(2)}
              >
                Dalej
              </button>
            </div>
          </>
        )}

        {tryb && krok === 2 && (
          <>
            <h2>Ile posiłków dziennie jesz?</h2>
            <p className="podtytul" style={{ marginBottom: 16 }}>
              Rozkład dnia dobieramy sami — dzięki temu każdy posiłek dostaje sensowny udział
              kalorii, a plan ma z czego losować dania.
            </p>
            <div className="siatka-wyboru">
              {UKLADY_DNIA.map((uklad) => (
                <button
                  key={uklad.liczba}
                  className={`kafelek ${liczbaPosilkow === uklad.liczba ? "wybrany" : ""}`}
                  onClick={() => setLiczbaPosilkow(uklad.liczba)}
                >
                  <span className="emoji">{uklad.liczba}</span>
                  {uklad.opis}
                </button>
              ))}
            </div>

            <div className="pref-chipsy" style={{ marginTop: 16 }}>
              {sloty.map((slot) => (
                <span key={slot} className="pref-chip lubie">
                  {NAZWY_SLOTOW[slot] ?? slot}
                </span>
              ))}
            </div>

            <div className="przyciski-nawigacji">
              <button className="btn btn-wstecz" onClick={() => setKrok(1)}>
                Wstecz
              </button>
              <button className="btn btn-dalej" onClick={() => setKrok(3)}>
                Dalej
              </button>
            </div>
          </>
        )}

        {tryb === "lodowka" && krok === 3 && (
          <KoszykLodowki
            kcalDzienne={trybKcal === "wprost" && typeof kcal === "number" ? kcal : undefined}
            dane={trybKcal === "wyliczone" && danePelne(dane) ? dane : undefined}
            makro={makro}
            sloty={sloty}
            onWstecz={() => setKrok(2)}
          />
        )}

        {tryb === "przepisy" && krok === 3 && (
          <>
            <h2>Czy są rzeczy, których nie możesz jeść?</h2>
            <div className="siatka-wyboru">
              {RESTRYKCJE_OPCJE.map((opcja) => (
                <button
                  key={opcja.id}
                  className={`kafelek ${restrykcje.includes(opcja.id) ? "wybrany" : ""}`}
                  onClick={() => przelaczRestrykcje(opcja.id)}
                >
                  <span className="emoji">{opcja.emoji}</span>
                  {opcja.label}
                </button>
              ))}
            </div>
            <div className="przyciski-nawigacji">
              <button className="btn btn-wstecz" onClick={() => setKrok(2)}>
                Wstecz
              </button>
              <button className="btn btn-dalej" onClick={() => setKrok(4)}>
                Dalej
              </button>
            </div>
          </>
        )}

        {tryb === "przepisy" && krok === 4 && (
          <>
            <h2>Co lubisz, a czego nie znosisz?</h2>
            <p className="podtytul" style={{ marginBottom: 8 }}>
              Kliknij raz — <strong style={{ color: "var(--neon-green)" }}>lubię</strong> (takie przepisy będą
              wypadać częściej). Kliknij drugi raz —{" "}
              <strong style={{ color: "#ff6b8a" }}>nie jem tego</strong> (wypada z planu całkiem). Trzeci raz
              czyści. Możesz też nic nie zaznaczać.
            </p>

            <div className="pref-podsumowanie">
              <span>✅ Lubię: {lubiane.length}</span>
              <span>🚫 Nie jem: {nielubiane.length}</span>
            </div>

            {grupySkladnikow.length === 0 && <p className="podtytul">Wczytuję składniki...</p>}

            {grupySkladnikow.map((grupa) => (
              <div key={grupa.grupa} className="pref-grupa">
                <div className="pref-grupa-nazwa">{grupa.grupa}</div>
                <div className="pref-chipsy">
                  {grupa.skladniki.map((skladnik) => {
                    const stan = preferencje[skladnik.id];
                    const klasa = stan === "lubie" ? "lubie" : stan === "nie-lubie" ? "nie-lubie" : "";
                    return (
                      <button
                        key={skladnik.id}
                        className={`pref-chip ${klasa}`}
                        onClick={() => przelaczPreferencje(skladnik.id)}
                      >
                        {stan === "lubie" && "✅ "}
                        {stan === "nie-lubie" && "🚫 "}
                        {skladnik.nazwa}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="przyciski-nawigacji">
              <button className="btn btn-wstecz" onClick={() => setKrok(3)}>
                Wstecz
              </button>
              {Object.keys(preferencje).length > 0 && (
                <button className="btn btn-wstecz" onClick={() => setPreferencje({})}>
                  Wyczyść
                </button>
              )}
              <button className="btn btn-dalej" disabled={ladowanie} onClick={generujPlan}>
                {ladowanie ? "Generuję..." : "Wygeneruj plan"}
              </button>
            </div>
            {blad && <div className="blad">{blad}</div>}
          </>
        )}

        {krok === 5 && plan && kreatorDla && (
          <KreatorPosilku
            slot={plan.dni[kreatorDla.dzien].posilki[kreatorDla.indeks].slot}
            cel={plan.celeSlotow[plan.dni[kreatorDla.dzien].posilki[kreatorDla.indeks].slot]}
            restrykcje={restrykcje}
            onZapisz={podmienPosilek}
            onAnuluj={() => setKreatorDla(null)}
          />
        )}

        {krok === 5 && plan && !kreatorDla && (
          <>
            <h2>Twój plan na tydzień</h2>
            <p className="podtytul" style={{ marginBottom: 8 }}>
              Orientacyjnie: {Math.round(plan.kcalDzienne)} kcal/dzień · B:{" "}
              {Math.round(plan.makroDzienne.bialko)}g · T: {Math.round(plan.makroDzienne.tluszcz)}g · W:{" "}
              {Math.round(plan.makroDzienne.wegle)}g
            </p>
            {/* Ton jest tu celowy: makro ma być wskazówką, a nie oceną dnia. */}
            <p className="podtytul">
              To są widełki, nie normy do wyrobienia. Dzień, w którym białko wyjdzie trochę niżej, jest
              w porządku — gdy brakuje go naprawdę sporo, silnik dokłada do posiłku zwykłe jedzenie
              (plaster szynki, jajko, trochę więcej mięsa), a nie odżywkę.
            </p>

            {plan.ostrzezenia?.map((tekst, i) => (
              <div key={i} className="kreator-ostrzezenie">
                ⚠ {tekst}
              </div>
            ))}

            {plan.dni.map((dzien) => (
              <div key={dzien.dzien} className="dzien-karta">
                <div className="dzien-naglowek">
                  <h3>Dzień {dzien.dzien}</h3>
                  <span className="podtytul">{Math.round(dzien.makroDnia.kcal)} kcal</span>
                </div>
                {dzien.posilki.map((posilek, i) => (
                  <div key={i} className="posilek">
                    <div className="posilek-nazwa">
                      {posilek.nazwa}
                      {posilek.wlasny && <span className="znacznik znacznik-baza">własny</span>}
                    </div>
                    <div className="posilek-makro">
                      {Math.round(posilek.makro.kcal)} kcal · B: {Math.round(posilek.makro.bialko)}g · T:{" "}
                      {Math.round(posilek.makro.tluszcz)}g · W: {Math.round(posilek.makro.wegle)}g
                    </div>
                    {posilek.uwaga && <span className="uwaga">⚠ {posilek.uwaga}</span>}
                    {posilek.dosypki?.map((d, j) => (
                      <div key={j} className="dosypka">
                        ➕ Do tego: <strong>{d.opis}</strong>
                      </div>
                    ))}
                    <div className="posilek-akcje">
                      <button
                        className="btn-maly"
                        onClick={() => setKreatorDla({ dzien: dzien.dzien - 1, indeks: i })}
                      >
                        Zbuduj sam
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))}

            <div className="przyciski-nawigacji">
              <button className="btn btn-wstecz" onClick={() => setKrok(4)}>
                Wstecz
              </button>
              <button className="btn btn-wstecz" disabled={ladowanie} onClick={generujPlan}>
                {ladowanie ? "Generuję..." : "Inny wariant"}
              </button>
              <button className="btn btn-dalej" onClick={() => setKrok(6)}>
                Zaakceptuj plan
              </button>
            </div>
          </>
        )}

        {krok === 6 && plan && (
          <>
            <h2>Szczegóły planu i przepisy</h2>

            <div id="sekcja-plan-druk">
              {plan.dni.map((dzien) => (
                <div key={dzien.dzien} className="dzien-karta">
                  <div className="dzien-naglowek">
                    <h3>Dzień {dzien.dzien}</h3>
                    <span className="podtytul">{Math.round(dzien.makroDnia.kcal)} kcal</span>
                  </div>
                  {dzien.posilki.map((posilek, i) => (
                    <div key={i} className="posilek">
                      <div className="posilek-nazwa">
                        {posilek.nazwa} <span className="podtytul">({posilek.slot})</span>
                        {/* Gotowiec to posiłek składany, nie gotowany — warto to widzieć od razu. */}
                        {posilek.gotowiec && <span className="znacznik znacznik-baza">bez gotowania</span>}
                      </div>
                      <div className="posilek-makro">
                        {Math.round(posilek.makro.kcal)} kcal · B: {Math.round(posilek.makro.bialko)}g · T:{" "}
                        {Math.round(posilek.makro.tluszcz)}g · W: {Math.round(posilek.makro.wegle)}g
                      </div>
                      {posilek.uwaga && <span className="uwaga">⚠ {posilek.uwaga}</span>}

                      {/* Dosypka jest dołożona przez silnik, a nie częścią przepisu — mówimy o tym
                          wprost, zamiast po cichu doklejać ją do listy składników. */}
                      {posilek.dosypki?.map((d, j) => (
                        <div key={j} className="dosypka">
                          ➕ Do tego: <strong>{d.opis}</strong> — dorzucone, żeby domknąć białko dnia
                        </div>
                      ))}

                      <p className="podtytul" style={{ marginTop: 10, marginBottom: 4 }}>
                        Składniki:
                      </p>
                      <ul>
                        {posilek.skladniki.map((s, j) => (
                          <li key={j} className="posilek-makro">
                            {s.nazwa} — {s.ilosc} {s.jednostka}
                          </li>
                        ))}
                      </ul>

                      {/* Posiłek złożony w kreatorze nie ma instrukcji — user wie, jak usmażyć własnego kurczaka. */}
                      {posilek.instrukcje.length > 0 && (
                        <>
                          <p className="podtytul" style={{ marginTop: 10, marginBottom: 4 }}>
                            Przygotowanie:
                          </p>
                          <ol>
                            {posilek.instrukcje.map((krokInstr, j) => (
                              <li key={j} className="posilek-makro">
                                {krokInstr}
                              </li>
                            ))}
                          </ol>
                        </>
                      )}

                      {posilek.dodatki?.map((dodatek, k) => (
                        <div key={k} style={{ marginTop: 14, paddingLeft: 14, borderLeft: "2px solid rgba(255,255,255,0.15)" }}>
                          <div className="posilek-nazwa">
                            + {dodatek.nazwa}{" "}
                            <span className="podtytul">
                              ({dodatek.kategoriaDania === "dodatek-skrobiowy" ? "dodatek" : "surówka"})
                            </span>
                          </div>
                          <div className="posilek-makro">
                            {Math.round(dodatek.makro.kcal)} kcal · B: {Math.round(dodatek.makro.bialko)}g · T:{" "}
                            {Math.round(dodatek.makro.tluszcz)}g · W: {Math.round(dodatek.makro.wegle)}g
                          </div>
                          <ul>
                            {dodatek.skladniki.map((s, j) => (
                              <li key={j} className="posilek-makro">
                                {s.nazwa} — {s.ilosc} {s.jednostka}
                              </li>
                            ))}
                          </ul>
                          <ol>
                            {dodatek.instrukcje.map((krokInstr, j) => (
                              <li key={j} className="posilek-makro">
                                {krokInstr}
                              </li>
                            ))}
                          </ol>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <h2>Bilans mikroskładników</h2>
            <BilansMikro
              dni={plan.dni.map((dzien) =>
                dzien.posilki.flatMap((p) => [
                  ...p.skladnikiBazowe,
                  ...(p.dodatki ?? []).flatMap((d) => d.skladnikiBazowe),
                ])
              )}
              plec={trybKcal === "wyliczone" && dane.plec !== "" ? dane.plec : undefined}
            />

            <h2>Lista zakupów na tydzień</h2>
            <div id="sekcja-lista-druk" className="lista-zakupow">
              {plan.listaZakupow.map((pozycja) => (
                <div key={pozycja.skladnikId} className="lista-zakupow-pozycja">
                  {pozycja.nazwa}: {pozycja.ilosc} {pozycja.jednostka}
                </div>
              ))}
            </div>

            <div className="przyciski-nawigacji nie-do-druku">
              <button className="btn btn-wstecz" onClick={() => setKrok(5)}>
                Wstecz
              </button>
              <button className="btn btn-dalej" onClick={() => pobierzPDF("plan")}>
                Pobierz plan (PDF)
              </button>
              <button className="btn btn-dalej" onClick={() => pobierzPDF("lista")}>
                Pobierz listę zakupów (PDF)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
