"use client";

import { useState } from "react";
import { PUSTY_PROFIL, SLOTY_DLA_LICZBY, type DanePomiarowe, type Profil } from "@/lib/magazyn";
import type { Charakter, Sprzet } from "@/lib/engine/types";

/**
 * Ankieta powitalna — wypełniana raz, przy pierwszym wejściu. Wynik ląduje w profilu
 * (`lib/magazyn.ts`), więc przy kolejnych wizytach user od razu widzi menu.
 *
 * Świadomie NIE pytamy tu o lubiane i nielubiane składniki (to było 49 chipsów do przeklikania).
 * Zamiast tego pytamy o **smak per posiłek** — krócej i bliżej tego, jak ludzie myślą o jedzeniu.
 * Zaznaczenie obu smaków albo żadnego znaczy „bez znaczenia".
 */

const KCAL_PRESETY = [1800, 2000, 2200, 2500, 3000];

const MAKRO_PRESETY = [
  { label: "Zbilansowane", opis: "30 / 35 / 35", makro: { bialko: 30, tluszcz: 35, wegle: 35 } },
  { label: "Wysokobiałkowe", opis: "40 / 30 / 30", makro: { bialko: 40, tluszcz: 30, wegle: 30 } },
  { label: "Mniej tłuszczu", opis: "30 / 20 / 50", makro: { bialko: 30, tluszcz: 20, wegle: 50 } },
];

const UKLADY = [
  { liczba: 3 as const, opis: "śniadanie, obiad, kolacja" },
  { liczba: 4 as const, opis: "+ drugie śniadanie" },
  { liczba: 5 as const, opis: "+ przekąska przed kolacją" },
];

const NAZWY_SLOTOW: Record<string, string> = {
  sniadanie: "🌅 Śniadanie",
  "drugie-sniadanie": "🥪 II śniadanie",
  obiad: "🍽️ Obiad",
  podwieczorek: "🍓 Podwieczorek",
  kolacja: "🌙 Kolacja",
};

const SMAKI: { id: Charakter; label: string }[] = [
  { id: "slodkie", label: "🍯 Słodko" },
  { id: "wytrawne", label: "🧂 Słono" },
];

const STYLE = [
  { id: "lubie-gotowac" as const, emoji: "🍳", label: "Lubię gotować", opis: "dłuższe przepisy mile widziane" },
  { id: "normalnie" as const, emoji: "🍽️", label: "Normalnie", opis: "po prostu dobre jedzenie" },
  { id: "minimum-roboty" as const, emoji: "⚡", label: "Minimum roboty", opis: "kanapki, tortille, szybkie rzeczy" },
];

const SPRZET_OPCJE: { id: Sprzet; label: string; emoji: string }[] = [
  { id: "piekarnik", label: "Piekarnik", emoji: "🔥" },
  { id: "patelnia", label: "Patelnia", emoji: "🍳" },
  { id: "garnek", label: "Garnek", emoji: "🥘" },
  { id: "blender", label: "Blender", emoji: "🌀" },
];

const RESTRYKCJE_OPCJE = [
  { id: "laktoza", label: "Laktoza", emoji: "🥛" },
  { id: "gluten", label: "Gluten", emoji: "🌾" },
  { id: "orzechy", label: "Orzechy", emoji: "🥜" },
  { id: "jajka", label: "Jajka", emoji: "🥚" },
];

const AKTYWNOSC_PRACA = [
  { id: 1 as const, label: "Siedząca" },
  { id: 2 as const, label: "Lekka" },
  { id: 3 as const, label: "Umiarkowana" },
  { id: 4 as const, label: "Ciężka fizyczna" },
];

const AKTYWNOSC_POZA = [
  { id: "A" as const, label: "Brak ruchu" },
  { id: "C" as const, label: "Spacer/bieg ~30 min" },
  { id: "E" as const, label: "Do godziny dziennie" },
  { id: "F" as const, label: "Ponad godzinę" },
];

export default function Onboarding({ onGotowe }: { onGotowe: (profil: Profil) => void }) {
  const [nick, setNick] = useState("");
  const [liczbaPosilkow, setLiczbaPosilkow] = useState<3 | 4 | 5>(3);
  const [smakPerSlot, setSmakPerSlot] = useState<Record<string, Charakter[]>>({});
  const [trybKcal, setTrybKcal] = useState<"wprost" | "wyliczone">("wprost");
  const [kcal, setKcal] = useState<number | "">(2000);
  const [makro, setMakro] = useState(PUSTY_PROFIL.makro);
  const [dane, setDane] = useState<DanePomiarowe>({});
  const [liczbaOsob, setLiczbaOsob] = useState(1);
  const [stylGotowania, setStylGotowania] = useState<Profil["stylGotowania"]>("normalnie");
  const [bezSprzetu, setBezSprzetu] = useState<Sprzet[]>([]);
  const [restrykcje, setRestrykcje] = useState<string[]>([]);

  const sloty = SLOTY_DLA_LICZBY[liczbaPosilkow];
  const daneKompletne =
    dane.waga && dane.wzrost && dane.wiek && dane.plec && dane.aktywnoscPraca && dane.aktywnoscPozaPraca && dane.cel;
  const mozeDalej = nick.trim().length > 0 && (trybKcal === "wprost" ? typeof kcal === "number" && kcal > 0 : !!daneKompletne);

  function przelaczSmak(slot: string, smak: Charakter) {
    setSmakPerSlot((aktualne) => {
      const teraz = aktualne[slot] ?? [];
      const nowe = teraz.includes(smak) ? teraz.filter((s) => s !== smak) : [...teraz, smak];
      return { ...aktualne, [slot]: nowe };
    });
  }

  function zapisz() {
    onGotowe({
      ...PUSTY_PROFIL,
      nick: nick.trim(),
      utworzony: new Date().toISOString(),
      liczbaPosilkow,
      liczbaOsob,
      smakPerSlot,
      kcalDzienne: trybKcal === "wprost" && typeof kcal === "number" ? kcal : undefined,
      dane: trybKcal === "wyliczone" ? dane : dane.waga ? { waga: dane.waga } : undefined,
      makro,
      stylGotowania,
      bezSprzetu,
      restrykcje,
    });
  }

  return (
    <>
      <h2>Cześć! Zanim zaczniemy</h2>
      <p className="podtytul">
        Kilka pytań, żeby nie zadawać ich przy każdym planie. Wszystko zostaje w tej przeglądarce —
        bez konta i bez hasła.
      </p>

      <h2>Jak masz na imię?</h2>
      <input
        className="kcal-input"
        placeholder="np. Łukasz"
        value={nick}
        maxLength={30}
        onChange={(e) => setNick(e.target.value)}
      />

      <h2 style={{ marginTop: 28 }}>Ile posiłków dziennie jesz?</h2>
      <div className="siatka-wyboru">
        {UKLADY.map((u) => (
          <button
            key={u.liczba}
            className={`kafelek ${liczbaPosilkow === u.liczba ? "wybrany" : ""}`}
            onClick={() => setLiczbaPosilkow(u.liczba)}
          >
            <span className="emoji">{u.liczba}</span>
            {u.opis}
          </button>
        ))}
      </div>

      <h2 style={{ marginTop: 28 }}>Co lubisz na te posiłki?</h2>
      <p className="podtytul" style={{ marginBottom: 12 }}>
        Możesz zaznaczyć oba smaki albo żaden — wtedy dobieramy bez preferencji. To podpowiedź,
        nie sztywna reguła: dania drugiego smaku nadal będą się pojawiać.
      </p>
      {sloty.map((slot) => (
        <div key={slot} className="charakter-wiersz">
          <span className="charakter-nazwa">{NAZWY_SLOTOW[slot]}</span>
          <div className="charakter-opcje">
            {SMAKI.map((s) => (
              <button
                key={s.id}
                className={`preset-btn ${(smakPerSlot[slot] ?? []).includes(s.id) ? "wybrany" : ""}`}
                onClick={() => przelaczSmak(slot, s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <h2 style={{ marginTop: 28 }}>Ile kalorii dziennie?</h2>
      <div className="presety">
        <button
          className={`preset-btn ${trybKcal === "wprost" ? "wybrany" : ""}`}
          onClick={() => setTrybKcal("wprost")}
        >
          Wiem ile
        </button>
        <button
          className={`preset-btn ${trybKcal === "wyliczone" ? "wybrany" : ""}`}
          onClick={() => setTrybKcal("wyliczone")}
        >
          Policz za mnie
        </button>
      </div>

      {trybKcal === "wprost" ? (
        <>
          <input
            className="kcal-input"
            type="number"
            value={kcal}
            onChange={(e) => setKcal(e.target.value === "" ? "" : Number(e.target.value))}
          />
          <div className="presety">
            {KCAL_PRESETY.map((k) => (
              <button key={k} className={`preset-btn ${kcal === k ? "wybrany" : ""}`} onClick={() => setKcal(k)}>
                {k}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="kreator-sterowanie" style={{ flexWrap: "wrap", gap: 10 }}>
          <input
            className="kreator-ilosc"
            type="number"
            placeholder="waga"
            value={dane.waga ?? ""}
            onChange={(e) => setDane({ ...dane, waga: Number(e.target.value) || undefined })}
          />
          <input
            className="kreator-ilosc"
            type="number"
            placeholder="wzrost"
            value={dane.wzrost ?? ""}
            onChange={(e) => setDane({ ...dane, wzrost: Number(e.target.value) || undefined })}
          />
          <input
            className="kreator-ilosc"
            type="number"
            placeholder="wiek"
            value={dane.wiek ?? ""}
            onChange={(e) => setDane({ ...dane, wiek: Number(e.target.value) || undefined })}
          />
          <div className="presety" style={{ width: "100%" }}>
            {(["K", "M"] as const).map((p) => (
              <button
                key={p}
                className={`preset-btn ${dane.plec === p ? "wybrany" : ""}`}
                onClick={() => setDane({ ...dane, plec: p })}
              >
                {p === "K" ? "Kobieta" : "Mężczyzna"}
              </button>
            ))}
          </div>
          <div className="presety" style={{ width: "100%" }}>
            {AKTYWNOSC_PRACA.map((a) => (
              <button
                key={a.id}
                className={`preset-btn ${dane.aktywnoscPraca === a.id ? "wybrany" : ""}`}
                onClick={() => setDane({ ...dane, aktywnoscPraca: a.id })}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="presety" style={{ width: "100%" }}>
            {AKTYWNOSC_POZA.map((a) => (
              <button
                key={a.id}
                className={`preset-btn ${dane.aktywnoscPozaPraca === a.id ? "wybrany" : ""}`}
                onClick={() => setDane({ ...dane, aktywnoscPozaPraca: a.id })}
              >
                {a.label}
              </button>
            ))}
          </div>
          <div className="presety" style={{ width: "100%" }}>
            {(["redukcja", "utrzymanie", "masa"] as const).map((c) => (
              <button
                key={c}
                className={`preset-btn ${dane.cel === c ? "wybrany" : ""}`}
                onClick={() => setDane({ ...dane, cel: c })}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {trybKcal === "wprost" && (
        <>
          <h2 style={{ marginTop: 28 }}>Waga (opcjonalnie)</h2>
          <p className="podtytul" style={{ marginBottom: 8 }}>
            Jeśli ją podasz, apka będzie raz dziennie pytać o aktualną i przeliczać zapotrzebowanie.
          </p>
          <input
            className="kcal-input"
            type="number"
            placeholder="np. 82"
            value={dane.waga ?? ""}
            onChange={(e) => setDane({ ...dane, waga: Number(e.target.value) || undefined })}
          />
        </>
      )}

      <h2 style={{ marginTop: 28 }}>Rozkład makroskładników</h2>
      <div className="presety">
        {MAKRO_PRESETY.map((p) => (
          <button
            key={p.label}
            className={`preset-btn ${JSON.stringify(makro) === JSON.stringify(p.makro) ? "wybrany" : ""}`}
            onClick={() => setMakro(p.makro)}
          >
            {p.label} ({p.opis})
          </button>
        ))}
      </div>

      <h2 style={{ marginTop: 28 }}>Dla ilu osób gotujesz?</h2>
      <div className="presety">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`preset-btn ${liczbaOsob === n ? "wybrany" : ""}`} onClick={() => setLiczbaOsob(n)}>
            {n === 1 ? "tylko ja" : `${n} osoby`}
          </button>
        ))}
      </div>

      <h2 style={{ marginTop: 28 }}>Jak lubisz gotować?</h2>
      <div className="siatka-wyboru">
        {STYLE.map((s) => (
          <button
            key={s.id}
            className={`kafelek ${stylGotowania === s.id ? "wybrany" : ""}`}
            onClick={() => setStylGotowania(s.id)}
          >
            <span className="emoji">{s.emoji}</span>
            {s.label}
            <span className="posilek-makro">{s.opis}</span>
          </button>
        ))}
      </div>

      <h2 style={{ marginTop: 28 }}>Czego nie masz w kuchni?</h2>
      <div className="pref-chipsy">
        {SPRZET_OPCJE.map((o) => {
          const brak = bezSprzetu.includes(o.id);
          return (
            <button
              key={o.id}
              className={`pref-chip ${brak ? "nie-lubie" : ""}`}
              onClick={() => setBezSprzetu((a) => (brak ? a.filter((x) => x !== o.id) : [...a, o.id]))}
            >
              {o.emoji} {o.label}
              {brak ? " — nie mam" : ""}
            </button>
          );
        })}
      </div>

      <h2 style={{ marginTop: 28 }}>Czego nie jesz?</h2>
      <div className="pref-chipsy">
        {RESTRYKCJE_OPCJE.map((o) => {
          const wybrane = restrykcje.includes(o.id);
          return (
            <button
              key={o.id}
              className={`pref-chip ${wybrane ? "nie-lubie" : ""}`}
              onClick={() => setRestrykcje((a) => (wybrane ? a.filter((x) => x !== o.id) : [...a, o.id]))}
            >
              {o.emoji} {o.label}
            </button>
          );
        })}
      </div>

      <div className="przyciski-nawigacji">
        <button className="btn btn-dalej" disabled={!mozeDalej} onClick={zapisz}>
          Zaczynamy
        </button>
      </div>
    </>
  );
}
