import { getComponentById, getIngredientById, getRecipes } from "./data";
import { domknijBialko, makroDosypek, type Dosypka } from "./domykanie";
import { zlozGotowiec } from "./gotowce";
import { zbudujListeZakupow, type PozycjaListyZakupow, type SkladnikBazowyWPlanie } from "./lista-zakupow";
import {
  dodajMakro,
  pustaMakro,
  rozwiazPrzepis,
  rozwinDoBazowychSkladnikow,
  skalujMakro,
  zbudujFiltr,
  type FiltrSkladnikow,
} from "./macro";
import { jestKomponentem } from "./types";
import type { Charakter, CzasPrzygotowania, KategoriaDania, Makro, Recipe, RodzajPotrawy, Sprzet } from "./types";

export type { PozycjaListyZakupow, SkladnikBazowyWPlanie } from "./lista-zakupow";

export type AktywnoscWPracy = 1 | 2 | 3 | 4;
export type AktywnoscPozaPraca = "A" | "B" | "C" | "D" | "E" | "F";

export interface DaneAntropometryczne {
  waga: number;
  wzrost: number;
  wiek: number;
  plec: "M" | "K";
  aktywnoscPraca: AktywnoscWPracy;
  aktywnoscPozaPraca: AktywnoscPozaPraca;
  cel: "redukcja" | "utrzymanie" | "masa";
}

export interface RozkladMakroProcentowy {
  bialko: number;
  tluszcz: number;
  wegle: number;
}

export interface PlanRequest {
  kcalDzienne?: number;
  dane?: DaneAntropometryczne;
  makro?: RozkladMakroProcentowy;
  sloty: string[];
  charakterPerSlot?: Record<string, Charakter>;
  restrykcje: string[];
  /**
   * Id składników, które user lubi — preferencja MIĘKKA: podbija przepis w rankingu,
   * ale nigdy nie wyklucza pozostałych (inaczej przy 3 lubianych składnikach zostałyby 2 przepisy).
   */
  lubianeSkladniki?: string[];
  /**
   * Id składników, których user nie chce jeść — działa TWARDO, jak restrykcja: grupa wyboru
   * podstawia zamiennik, a przepis bez wyjścia wypada z puli.
   */
  nielubianeSkladniki?: string[];
  /**
   * Sprzęt, którego user NIE ma (np. `["piekarnik"]`). Działa twardo — bez piekarnika zapiekanki
   * po prostu nie da się zrobić. Zmierzone: odcięcie piekarnika i blendera naraz zostawia
   * 31-55 przepisów na slot, więc pula się od tego nie zapada.
   */
  bezSprzetu?: Sprzet[];
  /**
   * Ile user chce się narobić. Działa MIĘKKO — jako premia w rankingu, nie filtr. Twardy filtr
   * po czasie przygotowania powtórzyłby błąd `charakterPerSlot`: na obiad są w bazie tylko dwa
   * przepisy poniżej 15 minut, więc „minimum roboty" dałoby ten sam obiad przez cały tydzień.
   */
  stylGotowania?: StylGotowania;
  /**
   * Rodzaje potraw, które user lubi (naleśniki, jajka, zupy…). Działa MIĘKKO, jak lubiane
   * składniki: podbija te dania w rankingu, ale nie wyklucza reszty. Przy 229 przepisach
   * konkretny klasyk wypada rzadko i to jest jedyny sposób, żeby wychodził częściej.
   */
  ulubioneRodzaje?: RodzajPotrawy[];
  /** Na ile dni rozpisać plan (1, 3 albo 7). Domyślnie tydzień. */
  liczbaDni?: number;
  /**
   * Data pierwszego dnia planu (ISO, „2026-09-23"). Potrzebna wyłącznie po to, żeby wiedzieć,
   * które dni wypadają w weekend — wtedy trafiają tam dania wymagające dłuższego gotowania.
   * Brak daty = nie rozróżniamy dni i budżet trudnych dań rozkłada się po kolei.
   */
  dataStartu?: string;
  /**
   * Preferowany charakter posiłku per slot — MIĘKKO, jako premia w rankingu.
   *
   * Świadomie nie jest to `charakterPerSlot`, który filtruje twardo i dlatego został wyłączony
   * z UI: przy „wytrawnym drugim śniadaniu" pula schodziła do jednego przepisu na siedem dni.
   * Tu user może zaznaczyć oba smaki naraz (wtedy premii nie ma) albo jeden — i wtedy dania
   * tego smaku wychodzą częściej, ale reszta bazy nie znika.
   */
  smakPerSlot?: Record<string, Charakter[]>;
}

export type StylGotowania = "lubie-gotowac" | "normalnie" | "minimum-roboty";

/**
 * Premia w ocenie kandydata za czas przygotowania, osobno dla każdego stylu. Wartości są
 * porównywalne z premią za lubiane składniki (1 punkt za składnik), więc styl przechyla wybór,
 * ale nie unieważnia reszty kryteriów.
 */
const PREMIA_ZA_CZAS: Record<StylGotowania, Record<CzasPrzygotowania, number>> = {
  "lubie-gotowac": { "<15": 0, "15-30": 1, "30+": 2 },
  normalnie: { "<15": 0, "15-30": 0, "30+": 0 },
  "minimum-roboty": { "<15": 3, "15-30": 1, "30+": -2 },
};

/** Jak styl gotowania przestawia udział gotowców (mnożnik dla SZANSA_NA_GOTOWIEC). */
const MNOZNIK_GOTOWCOW: Record<StylGotowania, number> = {
  "lubie-gotowac": 0.3,
  normalnie: 1,
  "minimum-roboty": 1.6,
};

const WSPOLCZYNNIK_CELU: Record<DaneAntropometryczne["cel"], number> = {
  redukcja: 0.85,
  utrzymanie: 1.0,
  masa: 1.15,
};

/**
 * Udział w KALORIACH, nie w gramach — przeliczenie na gramy robi obliczMakroDzienne
 * (białko i węgle po 4 kcal/g, tłuszcz 9 kcal/g).
 */
export const DOMYSLNY_ROZKLAD_MAKRO: RozkladMakroProcentowy = { bialko: 30, tluszcz: 35, wegle: 35 };

const WAGI_SLOTOW: Record<string, number> = {
  sniadanie: 0.25,
  "drugie-sniadanie": 0.1,
  obiad: 0.3,
  podwieczorek: 0.1,
  kolacja: 0.25,
};

/** Jaki % kcal posiłku zabiera dany dodatek (reszta zostaje dla dania głównego). */
const WAGA_DODATKU: Record<"dodatek-skrobiowy" | "surowka", number> = {
  "dodatek-skrobiowy": 0.22,
  surowka: 0.13,
};

/**
 * Jak często dany slot dostaje „gotowca" (posiłek złożony z szablonu, bez przepisu — kanapka,
 * miska białkowa, koktajl) zamiast przepisu z bazy.
 *
 * Rozkład nie jest równy, bo i posiłki nie są równe: na drugie śniadanie i podwieczorek normalny
 * człowiek robi kanapkę albo sięga po jogurt z owocami, a nie piecze keksówkę. Obiad zostaje
 * w całości przy przepisach — to jedyny posiłek, przy którym gotowanie jest oczekiwane.
 *
 * Drugi powód jest techniczny: pula przepisów na lekkie sloty jest najmniejsza w bazie
 * (7 na drugie śniadanie), więc to tam plan powtarzał się najbardziej.
 */
const SZANSA_NA_GOTOWIEC: Record<string, number> = {
  sniadanie: 0.25,
  "drugie-sniadanie": 0.6,
  obiad: 0,
  podwieczorek: 0.5,
  kolacja: 0.2,
};

/**
 * Ile dań „na dłużej" wolno wrzucić do planu.
 *
 * Trudne = czas przygotowania 30+ minut ALBO wymagające oczekiwania (wyrastanie, noc w lodówce).
 * W bazie to prawie połowa przepisów (104 z 216), więc bez limitu plan na tydzień potrafił
 * składać się niemal wyłącznie z nich — a nikt nie gotuje godzinę siedem dni z rzędu.
 *
 * Limit jest na CAŁY plan, nie na dzień: tydzień dostaje trzy takie dania, trzy dni dwa,
 * jeden dzień najwyżej jedno.
 */
const BUDZET_TRUDNYCH: Record<number, number> = { 1: 1, 3: 2, 7: 3 };

/** Dla nietypowej długości planu: mniej więcej jedno trudne danie na 2-3 dni. */
function budzetTrudnych(liczbaDni: number): number {
  return BUDZET_TRUDNYCH[liczbaDni] ?? Math.max(1, Math.round(liczbaDni / 2.5));
}

function jestTrudny(przepis: Recipe): boolean {
  return przepis.czasPrzygotowania === "30+" || przepis.czasOczekiwania !== undefined;
}

const INDEKS_AKTYWNOSCI_POZA_PRACA: Record<AktywnoscPozaPraca, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6 };

/**
 * PAL (Physical Activity Level) wg tabeli: A.1 = 1.4, każdy krok pracy (1-4) i wysiłku
 * poza pracą (A-F) dodaje 0.1. Np. C.4 = 1.4 + (3-1)*0.1 + (4-1)*0.1 = 1.9.
 */
export function obliczPAL(aktywnoscPraca: AktywnoscWPracy, aktywnoscPozaPraca: AktywnoscPozaPraca): number {
  const indeksPozaPraca = INDEKS_AKTYWNOSCI_POZA_PRACA[aktywnoscPozaPraca];
  return 1.4 + (indeksPozaPraca - 1) * 0.1 + (aktywnoscPraca - 1) * 0.1;
}

/** Przyjmuje dowolny obiekt z kcal albo danymi antropometrycznymi — używa tego też tryb "z lodówki". */
export function obliczKcalDzienne(req: { kcalDzienne?: number; dane?: DaneAntropometryczne }): number {
  if (req.kcalDzienne) return req.kcalDzienne;
  if (!req.dane) throw new Error("Podaj kcalDzienne albo dane antropometryczne (dane)");
  const { waga, wzrost, wiek, plec, aktywnoscPraca, aktywnoscPozaPraca, cel } = req.dane;
  const bmr = plec === "M" ? 10 * waga + 6.25 * wzrost - 5 * wiek + 5 : 10 * waga + 6.25 * wzrost - 5 * wiek - 161;
  const pal = obliczPAL(aktywnoscPraca, aktywnoscPozaPraca);
  const tdee = bmr * pal;
  return Math.round(tdee * WSPOLCZYNNIK_CELU[cel]);
}

export function obliczMakroDzienne(kcal: number, rozklad: RozkladMakroProcentowy = DOMYSLNY_ROZKLAD_MAKRO): Makro {
  return {
    kcal,
    bialko: (kcal * rozklad.bialko) / 100 / 4,
    tluszcz: (kcal * rozklad.tluszcz) / 100 / 9,
    wegle: (kcal * rozklad.wegle) / 100 / 4,
  };
}

export function rozbijNaSloty(makroDzienne: Makro, sloty: string[]): Record<string, Makro> {
  const sumaWag = sloty.reduce((s, slot) => s + (WAGI_SLOTOW[slot] ?? 0.2), 0);
  const wynik: Record<string, Makro> = {};
  for (const slot of sloty) {
    const waga = (WAGI_SLOTOW[slot] ?? 0.2) / sumaWag;
    wynik[slot] = skalujMakro(makroDzienne, waga);
  }
  return wynik;
}

export interface SkladnikWPlanie {
  skladnikId: string;
  nazwa: string;
  ilosc: number;
  jednostka: string;
}

export interface DodatekWPlanie {
  recipeId: string;
  nazwa: string;
  kategoriaDania: "dodatek-skrobiowy" | "surowka";
  skladniki: SkladnikWPlanie[];
  /** Składniki rozwinięte do postaci "kupowalnej" (komponenty rozbite na surowce). */
  skladnikiBazowe: SkladnikBazowyWPlanie[];
  instrukcje: string[];
  makro: Makro;
}

/**
 * Półprodukt, który trzeba zrobić przed daniem: ciasto na pierogi, ciasto drożdżowe na pizzę.
 *
 * Wcześniej do planu trafiała sama pozycja „Ciasto pierogowe — 500 g" bez składu i bez
 * instrukcji, a przepis mówił „rozwałkuj ciasto" — user nie miał z czego go zrobić.
 */
export interface KomponentWPlanie {
  komponentId: string;
  nazwa: string;
  skladniki: SkladnikWPlanie[];
  instrukcje: string[];
}

export interface PosilekWPlanie {
  slot: string;
  recipeId: string;
  nazwa: string;
  /** Brak dla posiłku zbudowanego przez usera w kreatorze — nie klasyfikujemy jego wymysłów. */
  charakter?: Charakter;
  czasPrzygotowania?: Recipe["czasPrzygotowania"];
  czasOczekiwania?: string;
  uwaga?: string;
  skladniki: SkladnikWPlanie[];
  skladnikiBazowe: SkladnikBazowyWPlanie[];
  instrukcje: string[];
  makro: Makro;
  dodatki?: DodatekWPlanie[];
  /** Posiłek złożony ręcznie w kreatorze, a nie dobrany z bazy przepisów. */
  wlasny?: boolean;
  /**
   * Posiłek złożony z szablonu (kanapka, miska białkowa, koktajl) zamiast z przepisu —
   * „nic nie gotujesz, składasz". UI oznacza go osobnym znacznikiem.
   */
  gotowiec?: boolean;
  /** Gotowiec, którego naprawdę nie trzeba gotować (kanapka, miska) — w odróżnieniu od dania na ciepło. */
  bezGotowania?: boolean;
  /**
   * Zwykłe jedzenie dołożone do posiłku, żeby domknąć białko dnia („plaster szynki").
   * Wliczone już w `makro` i w `skladnikiBazowe`, ale trzymane osobno, żeby UI mogło
   * powiedzieć wprost, co jest z przepisu, a co dołożone — patrz domykanie.ts.
   */
  dosypki?: Dosypka[];
  /** Półprodukty do przygotowania przed daniem (ciasto) — patrz KomponentWPlanie. */
  komponenty?: KomponentWPlanie[];
}

export interface DzienWPlanie {
  dzien: number;
  posilki: PosilekWPlanie[];
  makroDnia: Makro;
}

export interface WygenerowanyPlan {
  kcalDzienne: number;
  makroDzienne: Makro;
  /** Cel makro dla każdego slotu — w to celuje kreator, gdy user buduje własny posiłek. */
  celeSlotow: Record<string, Makro>;
  dni: DzienWPlanie[];
  listaZakupow: PozycjaListyZakupow[];
  /** Co silnik musiał odpuścić — np. slot bez ani jednego wykonalnego przepisu. */
  ostrzezenia: string[];
}

/**
 * Losuje spośród najlepiej ocenionych. Losowanie (a nie „weź pierwszy z tablicy") jest tu
 * istotne: przy deterministycznym wyborze plan zawsze składał się z pierwszych N przepisów
 * w kolejności zapisu w JSON-ie, a reszta bazy nigdy nie wypadała.
 */
function losujNajlepszy(pula: Recipe[], ocen: (r: Recipe) => number): Recipe {
  let najlepszaOcena = -Infinity;
  let najlepsi: Recipe[] = [];
  for (const przepis of pula) {
    const ocena = ocen(przepis);
    if (ocena > najlepszaOcena) {
      najlepszaOcena = ocena;
      najlepsi = [przepis];
    } else if (ocena === najlepszaOcena) {
      najlepsi.push(przepis);
    }
  }
  return najlepsi[Math.floor(Math.random() * najlepsi.length)];
}

function wybierzKandydata(
  kandydaci: Recipe[],
  uzyteWTygodniu: Set<string>,
  uzyteWDniu: Set<string>,
  ocen: (r: Recipe) => number,
  /**
   * Wszystko, co padło w tym tygodniu w JAKIMKOLWIEK slocie. Bez tego licznik był per slot
   * i to samo danie potrafiło wyjść w poniedziałek na obiad, we wtorek na kolację i w czwartek
   * znowu na obiad — formalnie „bez powtórki", a dla usera ten sam kurczak trzeci raz.
   */
  uzyteGdziekolwiek?: Set<string>
): Recipe {
  if (uzyteGdziekolwiek) {
    const zupelnieNowe = kandydaci.filter((r) => !uzyteGdziekolwiek.has(r.id) && !uzyteWDniu.has(r.id));
    if (zupelnieNowe.length > 0) return losujNajlepszy(zupelnieNowe, ocen);
  }

  const niePowtorzoneDzisiajIWTygodniu = kandydaci.filter((r) => !uzyteWTygodniu.has(r.id) && !uzyteWDniu.has(r.id));
  if (niePowtorzoneDzisiajIWTygodniu.length > 0) return losujNajlepszy(niePowtorzoneDzisiajIWTygodniu, ocen);

  const przynajmniejNiePowtorzoneDzisiaj = kandydaci.filter((r) => !uzyteWDniu.has(r.id));
  if (przynajmniejNiePowtorzoneDzisiaj.length > 0) {
    uzyteWTygodniu.clear();
    return losujNajlepszy(przynajmniejNiePowtorzoneDzisiaj, ocen);
  }

  return losujNajlepszy(kandydaci, ocen);
}

/**
 * Ocena przepisu = ile lubianych składników zawiera. Liczymy raz na przepis i trzymamy w mapie,
 * bo rozwijanie składników czyta pliki z dysku, a dobór leci 7 dni × liczba slotów.
 */
/** Premia za trafienie w preferowany smak slotu — tego samego rzędu co lubiany składnik. */
const PREMIA_ZA_SMAK = 2;

/**
 * Premia za ulubiony rodzaj potrawy. Wyższa niż za smak, bo to bezpośrednia odpowiedź na
 * „nigdy nie trafiłem jajecznicy" — ma realnie przesuwać wybór, a nie tylko rozstrzygać remisy.
 * Dalej jest to jednak premia, nie filtr: dania spoza ulubionych rodzajów nadal wychodzą.
 */
const PREMIA_ZA_RODZAJ = 4;

/**
 * Jak często premia za ulubiony rodzaj w ogóle wchodzi w grę.
 *
 * `losujNajlepszy` wybiera wyłącznie spośród najwyżej ocenionych, więc KAŻDA dodatnia premia
 * działa w praktyce jak twardy filtr. Zmierzone: przy trzech zaznaczonych rodzajach dawało to
 * 86% posiłków z tych kategorii — czyli tydzień samych jajek, naleśników i zup.
 *
 * Dlatego premię stosujemy losowo, mniej więcej w dwóch trzecich posiłków. Ulubione wychodzą
 * wyraźnie częściej, ale reszta bazy nie znika. To jest ta „miękkość", którą obiecuje SPEC.
 */
const SZANSA_NA_ULUBIONY = 0.65;

function zbudujOcenePreferencji(
  filtr: FiltrSkladnikow,
  lubiane: string[],
  styl: StylGotowania = "normalnie",
  smaki?: Charakter[],
  ulubioneRodzaje?: RodzajPotrawy[]
): (r: Recipe) => number {
  const ulubione = new Set(ulubioneRodzaje ?? []);
  const zaSmak = (przepis: Recipe) =>
    smaki && smaki.length === 1 && przepis.charakter === smaki[0] ? PREMIA_ZA_SMAK : 0;
  const zaRodzaj = (przepis: Recipe) =>
    przepis.rodzaj !== undefined && ulubione.has(przepis.rodzaj) ? PREMIA_ZA_RODZAJ : 0;
  const zaCzas = (przepis: Recipe) =>
    (PREMIA_ZA_CZAS[styl][przepis.czasPrzygotowania] ?? 0) + zaSmak(przepis) + zaRodzaj(przepis);
  if (lubiane.length === 0) return zaCzas;
  const cache = new Map<string, number>();
  return (przepis: Recipe) => {
    const zapamietane = cache.get(przepis.id);
    if (zapamietane !== undefined) return zapamietane + zaCzas(przepis);

    const uzyte = new Set<string>();
    for (const pos of przepis.skladniki) {
      const bazowe = rozwinDoBazowychSkladnikow(pos, filtr);
      if (!bazowe) continue;
      for (const b of bazowe) uzyte.add(b.skladnikId);
    }
    const ocena = lubiane.reduce((suma, id) => suma + (uzyte.has(id) ? 1 : 0), 0);
    cache.set(przepis.id, ocena);
    return ocena + zaCzas(przepis);
  };
}

interface PrzygotowanaPozycja {
  skladniki: SkladnikWPlanie[];
  skladnikiBazowe: SkladnikBazowyWPlanie[];
  makro: Makro;
  komponenty: KomponentWPlanie[];
}

/** Skaluje przepis do targetKcal i buduje jego składniki w dwóch postaciach: do przepisu i do listy zakupów. */
function przygotujPozycje(przepis: Recipe, targetKcal: number, filtr: FiltrSkladnikow): PrzygotowanaPozycja {
  const rozwiazany = rozwiazPrzepis(przepis, filtr)!;
  const mnoznik = targetKcal / rozwiazany.makroNaPorcje.kcal;
  const wspolczynnikSkalowania = mnoznik / przepis.porcje;

  const makro = skalujMakro(rozwiazany.makroCalkowite, wspolczynnikSkalowania);

  const skladniki: SkladnikWPlanie[] = rozwiazany.pozycje.map((p) => ({
    skladnikId: p.skladnikId,
    nazwa: p.nazwaWyswietlana,
    ilosc:
      p.jednostka === "szt"
        ? Math.max(1, Math.ceil(p.ilosc * wspolczynnikSkalowania))
        : Math.round(p.ilosc * wspolczynnikSkalowania * 10) / 10,
    jednostka: p.jednostka,
  }));

  const skladnikiBazowe: SkladnikBazowyWPlanie[] = [];
  for (const pos of przepis.skladniki) {
    const bazowe = rozwinDoBazowychSkladnikow(pos, filtr);
    if (!bazowe) continue;
    for (const b of bazowe) {
      skladnikiBazowe.push({
        skladnikId: b.skladnikId,
        nazwa: getIngredientById(b.skladnikId).nazwa,
        ilosc: b.ilosc * wspolczynnikSkalowania,
        jednostka: b.jednostka,
      });
    }
  }

  /**
   * Komponenty rozpisujemy osobno: ich składniki i instrukcje są userowi potrzebne, żeby
   * w ogóle zrobić danie. Skalujemy je tym samym współczynnikiem co resztę przepisu.
   */
  const komponenty: KomponentWPlanie[] = [];
  for (const pos of przepis.skladniki) {
    if (!jestKomponentem(pos)) continue;
    const komponent = getComponentById(pos.komponentId);
    const proporcja = (pos.ilosc / komponent.iloscWynikowa) * wspolczynnikSkalowania;
    komponenty.push({
      komponentId: komponent.id,
      nazwa: komponent.nazwa,
      instrukcje: komponent.instrukcje,
      skladniki: komponent.skladniki.map((sur) => ({
        skladnikId: sur.skladnikId,
        nazwa: getIngredientById(sur.skladnikId).nazwa,
        ilosc:
          sur.jednostka === "szt"
            ? Math.max(1, Math.round(sur.ilosc * proporcja))
            : Math.round(sur.ilosc * proporcja * 10) / 10,
        jednostka: sur.jednostka,
      })),
    });
  }

  return { skladniki, skladnikiBazowe, makro, komponenty };
}

/**
 * Składa gotowy posiłek z wybranego przepisu: dobiera wymagane dodatki (ryż, surówka),
 * skaluje wszystko do celu kcal slotu i zwraca gotową pozycję planu.
 *
 * Wydzielone z `generujPlan`, bo dokładnie tego samego potrzebuje wymiana pojedynczego
 * posiłku (`zaproponujZamiennik`) — inaczej dodatki i skalowanie rozjechałyby się między
 * planem a podmianą.
 */
function zbudujPosilekZPrzepisu(opcje: {
  przepis: Recipe;
  slot: string;
  targetKcalSlotu: number;
  filtr: FiltrSkladnikow;
  maSprzet: (s?: Sprzet[]) => boolean;
  /** Wybór dodatku z puli — planer pilnuje tu powtórek w tygodniu, wymiana losuje. */
  wybierzDodatek: (kandydaci: Recipe[], kategoria: "dodatek-skrobiowy" | "surowka") => Recipe;
}): PosilekWPlanie {
  const { przepis, slot, targetKcalSlotu, filtr, maSprzet, wybierzDodatek } = opcje;
  const wszystkiePrzepisy = getRecipes();
  const wymaganeDodatki = przepis.wymaganeDodatki ?? [];
  const udzialDodatkow = wymaganeDodatki.reduce((suma, k) => suma + WAGA_DODATKU[k], 0);

  const dodatki: DodatekWPlanie[] = [];
  for (const kategoria of wymaganeDodatki) {
    const kandydaciDodatku = wszystkiePrzepisy.filter((r) => {
      if (r.kategoriaDania !== kategoria) return false;
      if (!r.slot.includes(slot)) return false;
      if (!maSprzet(r.sprzet)) return false;
      return rozwiazPrzepis(r, filtr) !== null;
    });
    if (kandydaciDodatku.length === 0) continue;

    const przepisDodatku = wybierzDodatek(kandydaciDodatku, kategoria);
    const przygotowany = przygotujPozycje(przepisDodatku, targetKcalSlotu * WAGA_DODATKU[kategoria], filtr);
    dodatki.push({
      recipeId: przepisDodatku.id,
      nazwa: przepisDodatku.nazwa,
      kategoriaDania: kategoria,
      skladniki: przygotowany.skladniki,
      skladnikiBazowe: przygotowany.skladnikiBazowe,
      instrukcje: przepisDodatku.instrukcje,
      makro: przygotowany.makro,
    });
  }

  const przygotowanyGlowny = przygotujPozycje(przepis, targetKcalSlotu * (1 - udzialDodatkow), filtr);
  return {
    slot,
    recipeId: przepis.id,
    nazwa: przepis.nazwa,
    charakter: przepis.charakter,
    czasPrzygotowania: przepis.czasPrzygotowania,
    czasOczekiwania: przepis.czasOczekiwania,
    uwaga: przepis.czasOczekiwania ? `Przygotuj wcześniej — wymaga ${przepis.czasOczekiwania} oczekiwania.` : undefined,
    skladniki: przygotowanyGlowny.skladniki,
    skladnikiBazowe: przygotowanyGlowny.skladnikiBazowe,
    instrukcje: przepis.instrukcje,
    makro: dodatki.reduce((suma, d) => dodajMakro(suma, d.makro), przygotowanyGlowny.makro),
    dodatki: dodatki.length > 0 ? dodatki : undefined,
    komponenty: przygotowanyGlowny.komponenty.length > 0 ? przygotowanyGlowny.komponenty : undefined,
  };
}

export function generujPlan(req: PlanRequest): WygenerowanyPlan {
  const kcalDzienne = obliczKcalDzienne(req);
  const makroDzienne = obliczMakroDzienne(kcalDzienne, req.makro);
  const targetSloty = rozbijNaSloty(makroDzienne, req.sloty);
  const wszystkiePrzepisy = getRecipes();
  const dania = wszystkiePrzepisy.filter((r) => (r.kategoriaDania ?? "glowne") === "glowne");

  const filtr = zbudujFiltr(req.restrykcje, req.nielubianeSkladniki ?? []);
  const styl = req.stylGotowania ?? "normalnie";
  // Dwie oceny na slot: z premią za ulubiony rodzaj i bez niej. Którą weźmiemy, decyduje
  // losowanie przy każdym posiłku — patrz SZANSA_NA_ULUBIONY.
  const ocenDlaSlotu = new Map<string, (r: Recipe) => number>();
  const ocenBezUlubionych = new Map<string, (r: Recipe) => number>();
  for (const slot of req.sloty) {
    ocenDlaSlotu.set(
      slot,
      zbudujOcenePreferencji(filtr, req.lubianeSkladniki ?? [], styl, req.smakPerSlot?.[slot], req.ulubioneRodzaje)
    );
    ocenBezUlubionych.set(
      slot,
      zbudujOcenePreferencji(filtr, req.lubianeSkladniki ?? [], styl, req.smakPerSlot?.[slot])
    );
  }

  /** Bez piekarnika zapiekanki nie da się zrobić — to jedyne twarde ograniczenie poza alergenami. */
  const bezSprzetu = new Set(req.bezSprzetu ?? []);
  const maSprzet = (potrzebny?: Sprzet[]) => !potrzebny?.some((s) => bezSprzetu.has(s));
  const ostrzezenia: string[] = [];
  const slotyBezKandydatow = new Set<string>();

  const uzyteNaSlot = new Map<string, Set<string>>();
  for (const slot of req.sloty) uzyteNaSlot.set(slot, new Set());

  /** Dania (przepisy) i szablony użyte w tym tygodniu gdziekolwiek — do pilnowania powtórek. */
  const uzyteWTygodniuGdziekolwiek = new Set<string>();
  const uzyteSzablony = new Set<string>();

  const uzyteNaKategorieDodatku = new Map<KategoriaDania, Set<string>>([
    ["dodatek-skrobiowy", new Set()],
    ["surowka", new Set()],
  ]);

  const dni: DzienWPlanie[] = [];

  const liczbaDni = req.liczbaDni && req.liczbaDni > 0 ? Math.min(req.liczbaDni, 14) : 7;

  /**
   * Budżet dań „na dłużej" i rozkładanie ich na weekend.
   *
   * Gdy znamy datę startu, w dni robocze wstrzymujemy się z trudnym daniem tak długo, jak
   * zostało dość weekendowych dni, żeby pomieścić resztę budżetu. Dzięki temu pieczenie
   * i wyrastanie ciasta ląduje w sobotę, a nie we wtorek przed pracą.
   */
  const start = req.dataStartu ? new Date(req.dataStartu) : null;
  const znamyDate = start !== null && !Number.isNaN(start.getTime());
  const jestWeekend = (indeksDnia: number): boolean => {
    if (!znamyDate) return false;
    const data = new Date(start!);
    data.setDate(data.getDate() + indeksDnia);
    const dzienTygodnia = data.getDay();
    return dzienTygodnia === 0 || dzienTygodnia === 6;
  };
  const budzet = budzetTrudnych(liczbaDni);
  let trudnychUzytych = 0;

  const wolnoTrudne = (indeksDnia: number): boolean => {
    if (trudnychUzytych >= budzet) return false;
    if (!znamyDate || jestWeekend(indeksDnia)) return true;
    let weekendowychPrzedNami = 0;
    for (let d = indeksDnia + 1; d < liczbaDni; d++) if (jestWeekend(d)) weekendowychPrzedNami++;
    // Trzymamy budżet dla nadchodzących weekendów; gdy ich nie starcza, gotujemy w tygodniu.
    return weekendowychPrzedNami < budzet - trudnychUzytych;
  };

  for (let dzien = 0; dzien < liczbaDni; dzien++) {
    const posilki: PosilekWPlanie[] = [];
    const uzyteWDniu = new Set<string>();

    for (const slot of req.sloty) {
      const ocen =
        Math.random() < SZANSA_NA_ULUBIONY ? ocenDlaSlotu.get(slot)! : ocenBezUlubionych.get(slot)!;
      const preferowanyCharakter = req.charakterPerSlot?.[slot];
      const wszyscyKandydaci = dania.filter((r) => {
        if (!r.slot.includes(slot)) return false;
        if (preferowanyCharakter && r.charakter !== preferowanyCharakter) return false;
        if (!maSprzet(r.sprzet)) return false;
        return rozwiazPrzepis(r, filtr) !== null;
      });

      // Budżet trudnych dań wyczerpany (albo dziś dzień roboczy) — zostawiamy tylko szybkie.
      // Gdyby po odcięciu nie zostało nic, wracamy do pełnej puli: pusty slot jest gorszy.
      const szybcy = wszyscyKandydaci.filter((r) => !jestTrudny(r));
      const kandydaci = wolnoTrudne(dzien) || szybcy.length === 0 ? wszyscyKandydaci : szybcy;

      /**
       * Gotowiec wchodzi w dwóch sytuacjach: z losowania (patrz SZANSA_NA_GOTOWIEC) albo
       * awaryjnie, gdy na ten slot nie ma ani jednego wykonalnego przepisu — wtedy zamiast
       * zostawić usera bez posiłku, składamy mu kanapkę z tego, co wolno mu jeść.
       *
       * Charakteru posiłku (słodkie/wytrawne) tu nie pilnujemy: szablon nie ma tego pola,
       * a wymuszanie go przez składniki to dokładnie ta heurystyka „per składnik", którą
       * tryb z lodówki już raz wyrzucił (patrz SPEC).
       */
      const losowanyGotowiec =
        !preferowanyCharakter && Math.random() < (SZANSA_NA_GOTOWIEC[slot] ?? 0) * MNOZNIK_GOTOWCOW[styl];
      if (losowanyGotowiec || kandydaci.length === 0) {
        const gotowiec = zlozGotowiec({
          slot,
          cel: targetSloty[slot],
          filtr,
          bezSprzetu: req.bezSprzetu,
          wyklucz: new Set([...uzyteSzablony, ...uzyteWDniu]),
          lubianeSkladniki: req.lubianeSkladniki,
        });

        if (gotowiec) {
          uzyteSzablony.add(gotowiec.szablonId);
          uzyteWDniu.add(gotowiec.szablonId);
          const skladniki: SkladnikWPlanie[] = gotowiec.skladniki.map((s) => ({ ...s }));
          posilki.push({
            slot,
            recipeId: `szablon:${gotowiec.szablonId}`,
            nazwa: gotowiec.nazwa,
            skladniki,
            skladnikiBazowe: skladniki.map((s) => ({ ...s })),
            instrukcje: gotowiec.instrukcje,
            makro: gotowiec.makro,
            gotowiec: true,
            bezGotowania: gotowiec.naZimno,
          });
          continue;
        }

        if (kandydaci.length === 0) {
          slotyBezKandydatow.add(slot);
          continue;
        }
      }

      const uzyte = uzyteNaSlot.get(slot)!;
      const przepis = wybierzKandydata(kandydaci, uzyte, uzyteWDniu, ocen, uzyteWTygodniuGdziekolwiek);
      if (jestTrudny(przepis)) trudnychUzytych++;
      uzyte.add(przepis.id);
      uzyteWDniu.add(przepis.id);
      uzyteWTygodniuGdziekolwiek.add(przepis.id);

      posilki.push(
        zbudujPosilekZPrzepisu({
          przepis,
          slot,
          targetKcalSlotu: targetSloty[slot].kcal,
          filtr,
          maSprzet,
          wybierzDodatek: (kandydaci, kategoria) => {
            const uzyteDodatku = uzyteNaKategorieDodatku.get(kategoria)!;
            const wybrany = wybierzKandydata(kandydaci, uzyteDodatku, uzyteWDniu, ocen);
            uzyteDodatku.add(wybrany.id);
            uzyteWDniu.add(wybrany.id);
            return wybrany;
          },
        })
      );
    }

    /**
     * Domknięcie dnia: jeśli po złożeniu wszystkich posiłków brakuje sporo białka, dokładamy
     * do nich zwykłe jedzenie (plaster szynki, jajko, trochę więcej mięsa do obiadu). Robimy
     * to PO doborze dań, a nie przez dobór — patrz domykanie.ts: apka ma pomagać jeść zdrowiej,
     * a nie dobierać każdy posiłek pod tabelkę makro.
     */
    const makroPrzedDomknieciem = posilki.reduce((suma, p) => dodajMakro(suma, p.makro), pustaMakro());
    const { dosypki } = domknijBialko(
      posilki.map((p) => ({
        slot: p.slot,
        charakter: p.charakter,
        skladnikiId: p.skladnikiBazowe.map((s) => s.skladnikId),
        makro: p.makro,
      })),
      makroPrzedDomknieciem,
      makroDzienne,
      filtr
    );

    for (const [indeks, dolozone] of dosypki) {
      const posilek = posilki[indeks];
      posilek.dosypki = dolozone;
      posilek.makro = dodajMakro(posilek.makro, makroDosypek(dolozone));
      // Do listy zakupów i bilansu mikro dosypka musi wejść jak każdy inny składnik.
      posilek.skladnikiBazowe = [
        ...posilek.skladnikiBazowe,
        ...dolozone.map((d) => ({ skladnikId: d.skladnikId, nazwa: d.nazwa, ilosc: d.ilosc, jednostka: d.jednostka })),
      ];
    }

    const makroDnia = posilki.reduce((suma, p) => dodajMakro(suma, p.makro), pustaMakro());
    dni.push({ dzien: dzien + 1, posilki, makroDnia });
  }

  // Cicho pominięty slot to najgorszy możliwy wynik — user dostałby dzień bez obiadu i nie wiedziałby dlaczego.
  for (const slot of slotyBezKandydatow) {
    ostrzezenia.push(
      `Slot "${slot}" został pominięty — przy tych restrykcjach, nielubianych składnikach ` +
        `i dostępnym sprzęcie żaden przepis z bazy nie jest wykonalny. Odznacz coś na liście ` +
        `"nie jem tego" albo na liście sprzętu.`
    );
  }

  return {
    kcalDzienne,
    makroDzienne,
    celeSlotow: targetSloty,
    dni,
    listaZakupow: zbudujListeZakupow(dni),
    ostrzezenia,
  };
}

export interface ZapytanieOZamiennik extends Omit<PlanRequest, "sloty"> {
  sloty: string[];
  /** Slot, do którego szukamy innego dania. */
  slot: string;
  /** Id przepisów i szablonów, których user już nie chce (w tym to, co ma teraz na talerzu). */
  wyklucz?: string[];
  /** true = user prosi wprost o coś bez przepisu (kanapka, miska, koktajl). */
  chceGotowca?: boolean;
  /**
   * Czego szukamy w tej propozycji. Budżet trudnych dań obowiązuje **tylko przy układaniu
   * planu** — przy wymianie user świadomie wybiera, co chce zrobić, więc dania „na dłużej"
   * muszą być osiągalne. Dlatego lista propozycji jest celowo mieszana.
   */
  preferuj?: "dowolne" | "szybkie" | "trudne";
}

/**
 * Jedno danie na wymianę — „daj mi tu coś innego" na widoku planu.
 *
 * Świadomie NIE regeneruje planu: user zaakceptował resztę tygodnia i nie chce, żeby zmiana
 * jednej kolacji przestawiła mu wszystko inne. Cel kcal slotu jest ten sam co w planie, więc
 * makro dnia zostaje w tych samych widełkach.
 */
export function zaproponujZamienniki(req: ZapytanieOZamiennik, ile = 3): PosilekWPlanie[] {
  const propozycje: PosilekWPlanie[] = [];
  const wyklucz = [...(req.wyklucz ?? [])];

  /**
   * Celowo mieszamy: coś szybkiego, coś „na dłużej" i jedna propozycja bez preferencji.
   * Bez tego przy stylu „minimum roboty" dania 30+ nigdy nie wypadały nawet przy ręcznej
   * wymianie, bo przegrywały w rankingu — a to właśnie wtedy user chce po nie sięgnąć.
   */
  const kolejnosc: ZapytanieOZamiennik["preferuj"][] = ["szybkie", "trudne", "dowolne"];

  for (let i = 0; i < ile; i++) {
    const preferuj = kolejnosc[i % kolejnosc.length];
    const p = zaproponujZamiennik({ ...req, wyklucz, preferuj }) ?? zaproponujZamiennik({ ...req, wyklucz });
    if (!p) break;
    propozycje.push(p);
    // Kolejna propozycja ma być inna — dokładamy to, co właśnie zaproponowaliśmy.
    wyklucz.push(p.recipeId.replace(/^szablon:/, ""), p.recipeId);
  }
  return propozycje;
}

export function zaproponujZamiennik(req: ZapytanieOZamiennik): PosilekWPlanie | null {
  const kcalDzienne = obliczKcalDzienne(req);
  const makroDzienne = obliczMakroDzienne(kcalDzienne, req.makro);
  const targetSloty = rozbijNaSloty(makroDzienne, req.sloty);
  const cel = targetSloty[req.slot];
  if (!cel) return null;

  const filtr = zbudujFiltr(req.restrykcje, req.nielubianeSkladniki ?? []);
  const styl = req.stylGotowania ?? "normalnie";
  const ocen = zbudujOcenePreferencji(
    filtr,
    req.lubianeSkladniki ?? [],
    styl,
    req.smakPerSlot?.[req.slot],
    req.ulubioneRodzaje
  );
  const bezSprzetu = new Set(req.bezSprzetu ?? []);
  const maSprzet = (potrzebny?: Sprzet[]) => !potrzebny?.some((s) => bezSprzetu.has(s));
  const wyklucz = new Set(req.wyklucz ?? []);

  if (!req.chceGotowca) {
    const kandydaci = getRecipes().filter((r) => {
      if ((r.kategoriaDania ?? "glowne") !== "glowne") return false;
      if (!r.slot.includes(req.slot)) return false;
      if (wyklucz.has(r.id)) return false;
      if (!maSprzet(r.sprzet)) return false;
      if (req.preferuj === "szybkie" && jestTrudny(r)) return false;
      if (req.preferuj === "trudne" && !jestTrudny(r)) return false;
      return rozwiazPrzepis(r, filtr) !== null;
    });

    if (kandydaci.length > 0) {
      const przepis = losujNajlepszy(kandydaci, ocen);
      return zbudujPosilekZPrzepisu({
        przepis,
        slot: req.slot,
        targetKcalSlotu: cel.kcal,
        filtr,
        maSprzet,
        // Przy wymianie nie ma historii tygodnia, więc dodatek losujemy spośród najlepszych.
        wybierzDodatek: (kandydaciDodatku) => losujNajlepszy(kandydaciDodatku, ocen),
      });
    }
  }

  const gotowiec = zlozGotowiec({
    slot: req.slot,
    cel,
    filtr,
    wyklucz,
    bezSprzetu: req.bezSprzetu,
    lubianeSkladniki: req.lubianeSkladniki,
  });
  if (!gotowiec) return null;

  const skladniki: SkladnikWPlanie[] = gotowiec.skladniki.map((s) => ({ ...s }));
  return {
    slot: req.slot,
    recipeId: `szablon:${gotowiec.szablonId}`,
    nazwa: gotowiec.nazwa,
    skladniki,
    skladnikiBazowe: skladniki.map((s) => ({ ...s })),
    instrukcje: gotowiec.instrukcje,
    makro: gotowiec.makro,
    gotowiec: true,
    bezGotowania: gotowiec.naZimno,
  };
}
