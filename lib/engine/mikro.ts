import { getIngredients } from "./data";
import type { SkladnikBazowyWPlanie } from "./lista-zakupow";
import { PREFIKS_PRODUKTU, type Mikro } from "./types";

/**
 * Bilans mikroskładników — warstwa **raportująca**, celowo odcięta od doboru posiłków.
 *
 * Silnik nigdy nie dobiera jedzenia pod żelazo czy wapń: solver optymalizuje gramatury po
 * czterech celach z `Makro` i dołożenie tam mikro skończyłoby się dosypywaniem szpinaku do
 * każdego obiadu, żeby dobić normę. Tutaj tylko sumujemy to, co i tak wyszło, i mówimy userowi,
 * ile z dziennego zapotrzebowania pokrył.
 *
 * Liczymy ze `skladnikiBazowe` posiłku — tej samej postaci, z której powstaje lista zakupów
 * (komponenty rozbite na surowce), więc działa identycznie dla planu z przepisów i dla trybu
 * "z lodówki", łącznie z posiłkami złożonymi ręcznie w kreatorze.
 */

export const KLUCZE_MIKRO = [
  "blonnik",
  "zelazo",
  "wapn",
  "magnez",
  "potas",
  "cynk",
  "witaminaC",
  "sod",
] as const;

export type KluczMikro = (typeof KLUCZE_MIKRO)[number];

export interface OpisMikro {
  klucz: KluczMikro;
  nazwa: string;
  jednostka: "g" | "mg";
  /**
   * `norma` = tyle trzeba zjeść (brak = niedobór).
   * `limit` = tyle najwyżej wolno (przekroczenie = problem) — dotyczy sodu.
   */
  typ: "norma" | "limit";
  /** Dzienne zapotrzebowanie/limit dla dorosłej osoby, wg płci. */
  dziennie: { K: number; M: number };
}

/**
 * Normy dla dorosłego (na podstawie powszechnych zaleceń żywieniowych). Świadomie jedna
 * tabela na płeć, bez podziału na wiek — przy tej skali aplikacji różnica jest mniejsza
 * niż niepewność samych danych o składnikach.
 */
export const OPISY_MIKRO: OpisMikro[] = [
  { klucz: "blonnik", nazwa: "Błonnik", jednostka: "g", typ: "norma", dziennie: { K: 25, M: 30 } },
  { klucz: "zelazo", nazwa: "Żelazo", jednostka: "mg", typ: "norma", dziennie: { K: 18, M: 10 } },
  { klucz: "wapn", nazwa: "Wapń", jednostka: "mg", typ: "norma", dziennie: { K: 1000, M: 1000 } },
  { klucz: "magnez", nazwa: "Magnez", jednostka: "mg", typ: "norma", dziennie: { K: 320, M: 420 } },
  { klucz: "potas", nazwa: "Potas", jednostka: "mg", typ: "norma", dziennie: { K: 3500, M: 3500 } },
  { klucz: "cynk", nazwa: "Cynk", jednostka: "mg", typ: "norma", dziennie: { K: 8, M: 11 } },
  { klucz: "witaminaC", nazwa: "Witamina C", jednostka: "mg", typ: "norma", dziennie: { K: 75, M: 90 } },
  { klucz: "sod", nazwa: "Sód", jednostka: "mg", typ: "limit", dziennie: { K: 2000, M: 2000 } },
];

export type Plec = "K" | "M";

export interface PozycjaBilansu {
  klucz: KluczMikro;
  nazwa: string;
  jednostka: "g" | "mg";
  typ: "norma" | "limit";
  /** Ile faktycznie wychodzi z policzonych składników. */
  ile: number;
  /** Dzienna norma albo limit. */
  cel: number;
  /** Procent normy/limitu (może przekroczyć 100). */
  procent: number;
  /** `norma`: brakuje / w normie. `limit`: w normie / przekroczony. */
  stan: "brak" | "ok" | "przekroczony";
}

export interface BilansMikro {
  pozycje: PozycjaBilansu[];
  /**
   * Jaki ułamek masy posiłku/dnia dało się w ogóle policzyć (0-1). Produkty z Open Food Facts
   * nie mają danych o mikroskładnikach, więc bez tej liczby "brakuje ci 40% żelaza" byłoby
   * kłamstwem — to jest dolne oszacowanie, nie pomiar.
   */
  pokrycieMasy: number;
  /** Nazwy pozycji, których nie dało się policzyć — żeby user wiedział, czego brakuje w danych. */
  niepoliczone: string[];
}

/** Poniżej tego pokrycia danych bilans jest zbyt dziurawy, żeby cokolwiek z niego wnioskować. */
export const PROG_WIARYGODNOSCI = 0.6;

/** Poniżej tylu % normy mówimy o niedoborze — pojedynczy dzień nie musi trafiać co do grama. */
const PROG_NIEDOBORU = 80;

function pustyMikro(): Mikro {
  return { blonnik: 0, zelazo: 0, wapn: 0, magnez: 0, potas: 0, cynk: 0, witaminaC: 0, sod: 0 };
}

/**
 * Sumuje mikroskładniki po składnikach bazowych. Jednostka "szt" jest przeliczana przez
 * `masaSztuki` tak samo jak w reszcie silnika; pozycje bez danych (produkty z OFF) są
 * pomijane, ale ich masa wchodzi do mianownika `pokrycieMasy`.
 */
export function policzMikro(skladniki: SkladnikBazowyWPlanie[]): {
  mikro: Mikro;
  pokrycieMasy: number;
  niepoliczone: string[];
} {
  const wgId = new Map(getIngredients().map((s) => [s.id, s]));
  const mikro = pustyMikro();
  const niepoliczone: string[] = [];
  let masaPoliczona = 0;
  let masaCalkowita = 0;

  for (const pozycja of skladniki) {
    const skladnik = pozycja.skladnikId.startsWith(PREFIKS_PRODUKTU) ? undefined : wgId.get(pozycja.skladnikId);
    const gramy =
      pozycja.jednostka === "szt" ? pozycja.ilosc * (skladnik?.masaSztuki ?? 0) : pozycja.ilosc;
    masaCalkowita += gramy;

    if (!skladnik?.mikroNa100g) {
      if (!niepoliczone.includes(pozycja.nazwa)) niepoliczone.push(pozycja.nazwa);
      continue;
    }

    masaPoliczona += gramy;
    for (const klucz of KLUCZE_MIKRO) mikro[klucz] += (skladnik.mikroNa100g[klucz] * gramy) / 100;
  }

  return {
    mikro,
    pokrycieMasy: masaCalkowita > 0 ? masaPoliczona / masaCalkowita : 1,
    niepoliczone,
  };
}

export function zbudujBilans(skladniki: SkladnikBazowyWPlanie[], plec: Plec = "M"): BilansMikro {
  const { mikro, pokrycieMasy, niepoliczone } = policzMikro(skladniki);

  const pozycje: PozycjaBilansu[] = OPISY_MIKRO.map((opis) => {
    const ile = mikro[opis.klucz];
    const cel = opis.dziennie[plec];
    const procent = cel > 0 ? (ile / cel) * 100 : 0;
    const stan: PozycjaBilansu["stan"] =
      opis.typ === "limit" ? (procent > 100 ? "przekroczony" : "ok") : procent < PROG_NIEDOBORU ? "brak" : "ok";

    return {
      klucz: opis.klucz,
      nazwa: opis.nazwa,
      jednostka: opis.jednostka,
      typ: opis.typ,
      ile: Math.round(ile * 10) / 10,
      cel,
      procent: Math.round(procent),
      stan,
    };
  });

  return { pozycje, pokrycieMasy, niepoliczone };
}
