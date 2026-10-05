import sekcjeSklepu from "@/data/sekcje-sklepu.json";
import type { DzienWPlanie } from "./planner";

/**
 * Lista zakupów liczona Z GOTOWEGO PLANU, a nie zbierana po drodze przy jego generowaniu.
 *
 * Ta różnica jest istotna: user może podmienić pojedynczy posiłek albo zbudować własny
 * (kreator) bez regenerowania całego tygodnia — wtedy listę wystarczy przeliczyć od nowa
 * z aktualnych dni. Dlatego moduł nie dotyka plików z danymi (żadnego `fs`) i da się go
 * zaimportować także po stronie klienta.
 */

export interface SkladnikBazowyWPlanie {
  /** Id ze spiżarni — składnik bazowy ("ryz-bialy-surowy") albo produkt z OFF ("off:5900..."). */
  skladnikId: string;
  nazwa: string;
  ilosc: number;
  jednostka: string;
}

/**
 * Dział sklepu. Kolejność jest kolejnością obchodzenia sklepu, a nie alfabetyczną — lista
 * posortowana po nazwie kazała biegać od warzyw do nabiału i z powrotem przy każdej pozycji.
 */
export const SEKCJE_SKLEPU = [
  "warzywa",
  "owoce",
  "mieso",
  "nabial",
  "pieczywo",
  "sypkie",
  "straczki",
  "bakalie",
  "przyprawy",
  "inne",
] as const;
export type SekcjaSklepu = (typeof SEKCJE_SKLEPU)[number];

export const NAZWY_SEKCJI: Record<SekcjaSklepu, string> = {
  warzywa: "🥬 Warzywa",
  owoce: "🍎 Owoce",
  mieso: "🥩 Mięso i wędliny",
  // „I zamienniki", bo trafia tu też jogurt sojowy, tofu i hummus — w sklepie leżą w tej samej
  // chłodni co nabiał, więc dzielenie ich na osobny dział kazałoby chodzić dwa razy w to samo miejsce.
  nabial: "🧀 Nabiał, jajka i zamienniki",
  pieczywo: "🍞 Pieczywo",
  sypkie: "🌾 Sypkie, makarony, kasze",
  straczki: "🥫 Puszki i strączki",
  bakalie: "🥜 Bakalie i słodkie",
  przyprawy: "🧂 Przyprawy, sosy, tłuszcze",
  inne: "🛒 Inne",
};

/**
 * Mapa składnik → dział jest osobnym plikiem, a nie polem w ingredients.json, bo ten moduł
 * z założenia nie czyta danych przez `fs` (patrz nagłówek) — JSON-a da się zaimportować
 * także w komponencie klienckim, który przelicza listę po podmianie posiłku.
 */
const SEKCJE: Record<string, string> = sekcjeSklepu;

export function sekcjaSkladnika(skladnikId: string): SekcjaSklepu {
  const sekcja = SEKCJE[skladnikId];
  // Produkt z Open Food Facts ("off:...") nie ma działu — nie wiemy, co to właściwie jest.
  return (SEKCJE_SKLEPU as readonly string[]).includes(sekcja) ? (sekcja as SekcjaSklepu) : "inne";
}

export interface PozycjaListyZakupow {
  skladnikId: string;
  nazwa: string;
  ilosc: number;
  jednostka: string;
  sekcja: SekcjaSklepu;
}

export function zbudujListeZakupow(dni: DzienWPlanie[]): PozycjaListyZakupow[] {
  const zbiorcza = new Map<string, PozycjaListyZakupow>();

  const dodaj = (skladniki: SkladnikBazowyWPlanie[]) => {
    for (const skladnik of skladniki) {
      // Ten sam składnik w różnych jednostkach (szt vs g) to osobne pozycje — inaczej
      // zsumowalibyśmy 2 sztuki jajka z 110 gramami jajka.
      const klucz = `${skladnik.skladnikId}__${skladnik.jednostka}`;
      const istniejaca = zbiorcza.get(klucz);
      if (istniejaca) {
        istniejaca.ilosc += skladnik.ilosc;
      } else {
        zbiorcza.set(klucz, { ...skladnik, sekcja: sekcjaSkladnika(skladnik.skladnikId) });
      }
    }
  };

  for (const dzien of dni) {
    for (const posilek of dzien.posilki) {
      dodaj(posilek.skladnikiBazowe);
      for (const dodatek of posilek.dodatki ?? []) dodaj(dodatek.skladnikiBazowe);
    }
  }

  for (const pozycja of zbiorcza.values()) {
    pozycja.ilosc = pozycja.jednostka === "szt" ? Math.ceil(pozycja.ilosc) : Math.round(pozycja.ilosc * 10) / 10;
  }

  // Najpierw dział (kolejność obchodzenia sklepu), dopiero w nim alfabetycznie.
  return [...zbiorcza.values()].sort(
    (a, b) =>
      SEKCJE_SKLEPU.indexOf(a.sekcja) - SEKCJE_SKLEPU.indexOf(b.sekcja) || a.nazwa.localeCompare(b.nazwa, "pl")
  );
}
