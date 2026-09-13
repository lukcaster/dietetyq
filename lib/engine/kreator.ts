import type { SkladnikBazowyWPlanie } from "./lista-zakupow";
import { dodajMakro, pustaMakro } from "./macro";
import type { PosilekWPlanie, SkladnikWPlanie } from "./planner";
import { dobierzIlosci, type Odchylenia, type PozycjaDoDobrania } from "./solver";
import { maZakazanyAlergen, pobierzPozycjeSpizarni } from "./spizarnia";
import type { Makro, PozycjaSpizarni } from "./types";

/**
 * Kreator własnego posiłku — ścieżka dla kogoś, kto nie chce przepisu, tylko mówi
 * "dziś smażony kurczak": wybiera kurczaka, oliwę i warzywa, a silnik dobiera gramatury
 * pod cel kaloryczno-makrowy slotu.
 *
 * Wynik jest zwykłym `PosilekWPlanie`, więc wchodzi w plan w miejsce dowolnego posiłku
 * i liczy się do makro dnia oraz do listy zakupów tak samo jak posiłek z bazy przepisów.
 */

export type JednostkaKreatora = "g" | "ml" | "szt";

export interface PozycjaKreatora {
  /** Id ze spiżarni: składnik bazowy albo produkt z OFF ("off:..."). */
  id: string;
  ilosc: number;
  jednostka: JednostkaKreatora;
  /** Ilość zablokowana przez usera — solver jej nie rusza ("150 g piersi ma zostać 150 g"). */
  stala?: boolean;
  min?: number;
  max?: number;
}

export interface ZapytanieKreatora {
  slot: string;
  nazwa?: string;
  pozycje: PozycjaKreatora[];
  restrykcje?: string[];
  /** Cel makro posiłku — zwykle target slotu z planu. */
  cel?: Makro;
  /** Gdy true i podano cel: solver dobiera gramatury pozycji nieoznaczonych jako stałe. */
  dopasuj?: boolean;
}

export interface WynikKreatora {
  posilek: PosilekWPlanie;
  cel?: Makro;
  odchylenia?: Odchylenia;
  ostrzezenia: string[];
}

/** Powyżej tego rozjazdu (w %) mówimy wprost, że celu nie da się trafić tym zestawem. */
const PROG_OSTRZEZENIA_PROCENT = 10;

const KROK_JEDNOSTKI: Record<JednostkaKreatora, number> = { g: 5, ml: 5, szt: 1 };

function nazwaWyswietlana(pozycja: PozycjaSpizarni): string {
  return pozycja.marka ? `${pozycja.nazwa} (${pozycja.marka})` : pozycja.nazwa;
}

/**
 * Makro jednej jednostki. `ml` traktujemy jak gramy — tak samo jak reszta silnika
 * (patrz masaWGramach w macro.ts); dla mleka czy oleju błąd z gęstości jest pomijalny
 * wobec rozrzutu samych tabel wartości odżywczych.
 */
export function makroNaJednostke(pozycja: PozycjaSpizarni, jednostka: JednostkaKreatora): Makro {
  const gramyNaJednostke = jednostka === "szt" ? (pozycja.masaSztuki ?? 0) : 1;
  const wspolczynnik = gramyNaJednostke / 100;
  return {
    kcal: pozycja.makroNa100g.kcal * wspolczynnik,
    bialko: pozycja.makroNa100g.bialko * wspolczynnik,
    tluszcz: pozycja.makroNa100g.tluszcz * wspolczynnik,
    wegle: pozycja.makroNa100g.wegle * wspolczynnik,
  };
}

function zaokraglijIlosc(ilosc: number, jednostka: JednostkaKreatora): number {
  return jednostka === "szt" ? Math.round(ilosc) : Math.round(ilosc * 10) / 10;
}

export function zbudujPosilekWlasny(zapytanie: ZapytanieKreatora): WynikKreatora {
  const restrykcje = zapytanie.restrykcje ?? [];
  if (zapytanie.pozycje.length === 0) throw new Error("Posiłek musi mieć co najmniej jeden składnik");

  const ostrzezenia: string[] = [];
  const rozwiazane = zapytanie.pozycje.map((pozycja) => {
    const zeSpizarni = pobierzPozycjeSpizarni(pozycja.id);
    if (pozycja.ilosc < 0) throw new Error(`Ujemna ilość dla "${zeSpizarni.nazwa}"`);
    if (pozycja.jednostka === "szt" && !zeSpizarni.masaSztuki) {
      throw new Error(`"${zeSpizarni.nazwa}" nie ma zdefiniowanej masy sztuki — podaj ilość w gramach`);
    }

    if (maZakazanyAlergen(zeSpizarni, restrykcje)) {
      const zakazane = zeSpizarni.tagiAlergenow.filter((t) => restrykcje.includes(t));
      ostrzezenia.push(`${nazwaWyswietlana(zeSpizarni)} zawiera: ${zakazane.join(", ")} — masz to na liście restrykcji.`);
    } else if (zeSpizarni.alergenyNieznane && restrykcje.length > 0) {
      ostrzezenia.push(
        `${nazwaWyswietlana(zeSpizarni)}: alergeny nieuzupełnione w Open Food Facts — sprawdź opakowanie.`
      );
    }

    return { wejscie: pozycja, zeSpizarni };
  });

  let ilosci = rozwiazane.map((r) => r.wejscie.ilosc);
  let odchylenia: Odchylenia | undefined;

  if (zapytanie.dopasuj && zapytanie.cel) {
    const doDobrania: PozycjaDoDobrania[] = rozwiazane.map(({ wejscie, zeSpizarni }) => ({
      id: wejscie.id,
      makroNaJednostke: makroNaJednostke(zeSpizarni, wejscie.jednostka),
      ilosc: wejscie.ilosc,
      stala: wejscie.stala,
      min: wejscie.min ?? 0,
      // Bez sufitu solver potrafi dosypać 300 g oliwy, byle dobić kcal.
      max: wejscie.max ?? (wejscie.jednostka === "szt" ? Math.max(wejscie.ilosc * 3, 4) : Math.max(wejscie.ilosc * 4, 100)),
      krok: KROK_JEDNOSTKI[wejscie.jednostka],
    }));

    const wynik = dobierzIlosci(doDobrania, zapytanie.cel);
    ilosci = wynik.pozycje.map((p) => p.ilosc);
    odchylenia = wynik.odchylenia;

    if (wynik.najwiekszeOdchylenie > PROG_OSTRZEZENIA_PROCENT) {
      ostrzezenia.push(
        `Tym zestawem nie da się trafić w cel — największy rozjazd to ${Math.round(wynik.najwiekszeOdchylenie)}%. ` +
          `Dodaj składnik, który nadrobi brakujące makro, albo poluzuj limity ilości.`
      );
    }

    for (let i = 0; i < wynik.pozycje.length; i++) {
      const pozycja = wynik.pozycje[i];
      if (!pozycja.przyLimicie) continue;
      const nazwa = nazwaWyswietlana(rozwiazane[i].zeSpizarni);
      const granica = pozycja.przyLimicie === "max" ? "górny" : "dolny";
      ostrzezenia.push(`${nazwa}: solver oparł się o ${granica} limit ilości (${pozycja.ilosc}).`);
    }
  }

  const skladniki: SkladnikWPlanie[] = [];
  const skladnikiBazowe: SkladnikBazowyWPlanie[] = [];
  let makro = pustaMakro();

  for (let i = 0; i < rozwiazane.length; i++) {
    const { wejscie, zeSpizarni } = rozwiazane[i];
    const ilosc = zaokraglijIlosc(ilosci[i], wejscie.jednostka);
    const naJednostke = makroNaJednostke(zeSpizarni, wejscie.jednostka);
    makro = dodajMakro(makro, {
      kcal: naJednostke.kcal * ilosc,
      bialko: naJednostke.bialko * ilosc,
      tluszcz: naJednostke.tluszcz * ilosc,
      wegle: naJednostke.wegle * ilosc,
    });

    const wpis = { skladnikId: wejscie.id, nazwa: nazwaWyswietlana(zeSpizarni), ilosc, jednostka: wejscie.jednostka };
    skladniki.push(wpis);
    skladnikiBazowe.push({ ...wpis });
  }

  const posilek: PosilekWPlanie = {
    slot: zapytanie.slot,
    recipeId: "wlasny",
    nazwa: zapytanie.nazwa?.trim() || "Posiłek własny",
    skladniki,
    skladnikiBazowe,
    instrukcje: [],
    makro,
    wlasny: true,
  };

  return { posilek, cel: zapytanie.cel, odchylenia, ostrzezenia };
}
