import type { Makro } from "./types";

/**
 * Lokalna kopia skalowania makro. `macro.ts` ma tę samą funkcję, ale ciągnie za sobą `data.ts`
 * (czyli `fs`), a ten moduł musi dać się zaimportować w przeglądarce. Cztery mnożenia nie są
 * warte łańcucha zależności.
 */
function skalujMakro(m: Makro, mnoznik: number): Makro {
  return {
    kcal: m.kcal * mnoznik,
    bialko: m.bialko * mnoznik,
    tluszcz: m.tluszcz * mnoznik,
    wegle: m.wegle * mnoznik,
  };
}

/**
 * Czysta arytmetyka celów: zapotrzebowanie kaloryczne, rozbicie na makro i podział na posiłki.
 *
 * Wydzielone z `planner.ts`, bo planer czyta `data/*.json` przez `fs` i **nie da się go
 * zaimportować do komponentu klienckiego** — kończy się błędem „Can't resolve 'fs'". Widok
 * „ułożę plan sam" potrzebuje tylko tych liczb, żeby pokazać, w co celuje każdy posiłek.
 *
 * Tu nie ma żadnego sięgania do bazy przepisów ani składników — sama matematyka.
 */

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


/** Komplet celów dla profilu — tego używa widok ręcznego układania planu. */
export function celeSlotowDla(req: {
  kcalDzienne?: number;
  dane?: DaneAntropometryczne;
  makro?: RozkladMakroProcentowy;
  sloty: string[];
}) {
  const kcalDzienne = obliczKcalDzienne(req);
  const makroDzienne = obliczMakroDzienne(kcalDzienne, req.makro);
  return { kcalDzienne, makroDzienne, celeSlotow: rozbijNaSloty(makroDzienne, req.sloty) };
}
