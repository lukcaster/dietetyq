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

export interface PozycjaListyZakupow {
  skladnikId: string;
  nazwa: string;
  ilosc: number;
  jednostka: string;
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
        zbiorcza.set(klucz, { ...skladnik });
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

  return [...zbiorcza.values()].sort((a, b) => a.nazwa.localeCompare(b.nazwa, "pl"));
}
