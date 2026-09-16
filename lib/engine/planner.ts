import { getIngredientById, getRecipes } from "./data";
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
import type { Charakter, KategoriaDania, Makro, Recipe } from "./types";

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
}

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
function zbudujOcenePreferencji(filtr: FiltrSkladnikow, lubiane: string[]): (r: Recipe) => number {
  if (lubiane.length === 0) return () => 0;
  const cache = new Map<string, number>();
  return (przepis: Recipe) => {
    const zapamietane = cache.get(przepis.id);
    if (zapamietane !== undefined) return zapamietane;

    const uzyte = new Set<string>();
    for (const pos of przepis.skladniki) {
      const bazowe = rozwinDoBazowychSkladnikow(pos, filtr);
      if (!bazowe) continue;
      for (const b of bazowe) uzyte.add(b.skladnikId);
    }
    const ocena = lubiane.reduce((suma, id) => suma + (uzyte.has(id) ? 1 : 0), 0);
    cache.set(przepis.id, ocena);
    return ocena;
  };
}

interface PrzygotowanaPozycja {
  skladniki: SkladnikWPlanie[];
  skladnikiBazowe: SkladnikBazowyWPlanie[];
  makro: Makro;
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

  return { skladniki, skladnikiBazowe, makro };
}

export function generujPlan(req: PlanRequest): WygenerowanyPlan {
  const kcalDzienne = obliczKcalDzienne(req);
  const makroDzienne = obliczMakroDzienne(kcalDzienne, req.makro);
  const targetSloty = rozbijNaSloty(makroDzienne, req.sloty);
  const wszystkiePrzepisy = getRecipes();
  const dania = wszystkiePrzepisy.filter((r) => (r.kategoriaDania ?? "glowne") === "glowne");

  const filtr = zbudujFiltr(req.restrykcje, req.nielubianeSkladniki ?? []);
  const ocen = zbudujOcenePreferencji(filtr, req.lubianeSkladniki ?? []);
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

  for (let dzien = 0; dzien < 7; dzien++) {
    const posilki: PosilekWPlanie[] = [];
    const uzyteWDniu = new Set<string>();

    for (const slot of req.sloty) {
      const preferowanyCharakter = req.charakterPerSlot?.[slot];
      const kandydaci = dania.filter((r) => {
        if (!r.slot.includes(slot)) return false;
        if (preferowanyCharakter && r.charakter !== preferowanyCharakter) return false;
        return rozwiazPrzepis(r, filtr) !== null;
      });

      /**
       * Gotowiec wchodzi w dwóch sytuacjach: z losowania (patrz SZANSA_NA_GOTOWIEC) albo
       * awaryjnie, gdy na ten slot nie ma ani jednego wykonalnego przepisu — wtedy zamiast
       * zostawić usera bez posiłku, składamy mu kanapkę z tego, co wolno mu jeść.
       *
       * Charakteru posiłku (słodkie/wytrawne) tu nie pilnujemy: szablon nie ma tego pola,
       * a wymuszanie go przez składniki to dokładnie ta heurystyka „per składnik", którą
       * tryb z lodówki już raz wyrzucił (patrz SPEC).
       */
      const losowanyGotowiec = !preferowanyCharakter && Math.random() < (SZANSA_NA_GOTOWIEC[slot] ?? 0);
      if (losowanyGotowiec || kandydaci.length === 0) {
        const gotowiec = zlozGotowiec({
          slot,
          cel: targetSloty[slot],
          filtr,
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
      uzyte.add(przepis.id);
      uzyteWDniu.add(przepis.id);
      uzyteWTygodniuGdziekolwiek.add(przepis.id);

      const targetKcalSlotu = targetSloty[slot].kcal;
      const wymaganeDodatki = przepis.wymaganeDodatki ?? [];
      const udzialDodatkow = wymaganeDodatki.reduce((suma, k) => suma + WAGA_DODATKU[k], 0);

      const dodatki: DodatekWPlanie[] = [];
      for (const kategoria of wymaganeDodatki) {
        const kandydaciDodatku = wszystkiePrzepisy.filter((r) => {
          if (r.kategoriaDania !== kategoria) return false;
          if (!r.slot.includes(slot)) return false;
          return rozwiazPrzepis(r, filtr) !== null;
        });
        if (kandydaciDodatku.length === 0) continue;

        const uzyteDodatku = uzyteNaKategorieDodatku.get(kategoria)!;
        const przepisDodatku = wybierzKandydata(kandydaciDodatku, uzyteDodatku, uzyteWDniu, ocen);
        uzyteDodatku.add(przepisDodatku.id);
        uzyteWDniu.add(przepisDodatku.id);

        const targetKcalDodatku = targetKcalSlotu * WAGA_DODATKU[kategoria];
        const przygotowany = przygotujPozycje(przepisDodatku, targetKcalDodatku, filtr);

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

      const targetKcalGlownego = targetKcalSlotu * (1 - udzialDodatkow);
      const przygotowanyGlowny = przygotujPozycje(przepis, targetKcalGlownego, filtr);

      const makroFinalne = dodatki.reduce((suma, d) => dodajMakro(suma, d.makro), przygotowanyGlowny.makro);

      posilki.push({
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
        makro: makroFinalne,
        dodatki: dodatki.length > 0 ? dodatki : undefined,
      });
    }

    const makroDnia = posilki.reduce((suma, p) => dodajMakro(suma, p.makro), pustaMakro());
    dni.push({ dzien: dzien + 1, posilki, makroDnia });
  }

  // Cicho pominięty slot to najgorszy możliwy wynik — user dostałby dzień bez obiadu i nie wiedziałby dlaczego.
  for (const slot of slotyBezKandydatow) {
    ostrzezenia.push(
      `Slot "${slot}" został pominięty — przy tych restrykcjach i nielubianych składnikach ` +
        `żaden przepis z bazy nie jest wykonalny. Odznacz coś na liście "nie jem tego".`
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
