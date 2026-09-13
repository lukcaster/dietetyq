import { getComponentById, getIngredients, getRecipes } from "./data";
import {
  jestGrupaWyboru,
  jestKomponentem,
  type Charakter,
  type CzasPrzygotowania,
  type Ingredient,
  type Recipe,
} from "./types";

/**
 * „Dokup i zrobisz" — dopełnienie trybu z lodówki.
 *
 * `rozpiszZLodowki` bierze wyłącznie przepisy wykonalne w 100%, bo przepisu nie da się zrobić
 * „prawie". Ale ktoś, kto ma płatki, mleko i banana, a nie ma masła orzechowego, jest o jedną
 * rzecz od owsianki — i to jest informacja wartościowa, tylko nie do planu dnia, a do zakupów.
 *
 * Tu liczymy dla każdego przepisu głównego, co z niego user już ma, a czego brakuje. Nic nie
 * skalujemy i nie liczymy makro: to podpowiedź „co warto dokupić", nie posiłek w planie.
 */

export interface BrakujacySkladnik {
  id: string;
  nazwa: string;
  /** Ilość na cały przepis (na `porcje` porcji), bez skalowania do celu. */
  ilosc: number;
  jednostka: string;
  /** Dla grup wyboru: czym jeszcze da się to zastąpić (np. inne mleko). */
  zamienniki?: string[];
}

export interface PropozycjaDokupienia {
  recipeId: string;
  nazwa: string;
  slot: string[];
  charakter: Charakter;
  porcje: number;
  czasPrzygotowania: CzasPrzygotowania;
  /** Nazwy składników przepisu, które user ma w koszyku. */
  masz: string[];
  brakuje: BrakujacySkladnik[];
  /** Ile składników liczymy w przepisie — bez podstawowych zapasów (olej, woda). */
  wszystkich: number;
  instrukcje: string[];
}

export interface PropozycjeDokupienia {
  /** 2-3 wylosowane przepisy, do których brakuje niewiele — id z listy `wszystkie`. */
  wyroznione: string[];
  /** Wszystkie przepisy z czymś z lodówki i czymś do dokupienia, od najmniejszych braków. */
  wszystkie: PropozycjaDokupienia[];
}

const ILE_WYROZNIONYCH = 3;

/**
 * Wyróżniamy tylko przepisy, w których brakuje najwyżej połowy składników. „Dokup pięć rzeczy"
 * to już nie propozycja, tylko lista zakupów — takie przepisy zostają w rozwijanej liście.
 */
function wartyWyroznienia(p: PropozycjaDokupienia): boolean {
  return p.brakuje.length * 2 <= p.wszystkich;
}

/**
 * Losowanie bez zwracania z wagą 1/braki²: przepis z jednym brakiem wypada 4× częściej niż
 * z dwoma. Czysty ranking dawałby w kółko te same trzy propozycje przy każdym przeliczeniu,
 * czyste losowanie — „dokup cztery rzeczy" obok „dokup jedną".
 */
function losujWazone(pula: PropozycjaDokupienia[], ile: number): PropozycjaDokupienia[] {
  const zostale = [...pula];
  const wybrane: PropozycjaDokupienia[] = [];
  while (wybrane.length < ile && zostale.length > 0) {
    const wagi = zostale.map((p) => 1 / p.brakuje.length ** 2);
    let los = Math.random() * wagi.reduce((s, w) => s + w, 0);
    let indeks = 0;
    while (indeks < zostale.length - 1 && los >= wagi[indeks]) {
      los -= wagi[indeks];
      indeks++;
    }
    wybrane.push(zostale.splice(indeks, 1)[0]);
  }
  return wybrane;
}

interface Wymaganie {
  /** Id składnika albo `kategoria:<nazwa>` dla grupy wyboru — do scalania powtórzeń. */
  klucz: string;
  ilosc: number;
  jednostka: string;
  /** Kandydaci, którzy spełniają to wymaganie (dla zwykłej pozycji — jeden). */
  kandydaci: Ingredient[];
  preferowany: Ingredient;
}

function wymaganiaPrzepisu(przepis: Recipe, skladniki: Map<string, Ingredient>, wszystkie: Ingredient[]): Wymaganie[] {
  const wymagania = new Map<string, Wymaganie>();
  const dodaj = (w: Wymaganie) => {
    const istniejace = wymagania.get(w.klucz);
    // Ten sam składnik w cieście i w farszu to dalej jedna rzecz do kupienia.
    if (istniejace && istniejace.jednostka === w.jednostka) istniejace.ilosc += w.ilosc;
    else if (!istniejace) wymagania.set(w.klucz, w);
  };
  const prosty = (id: string, ilosc: number, jednostka: string) => {
    const skladnik = skladniki.get(id);
    if (!skladnik) throw new Error(`Przepis "${przepis.id}" odwołuje się do nieznanego składnika: ${id}`);
    dodaj({ klucz: id, ilosc, jednostka, kandydaci: [skladnik], preferowany: skladnik });
  };

  for (const pos of przepis.skladniki) {
    if (jestGrupaWyboru(pos)) {
      const kandydaci = wszystkie.filter((s) => s.kategoria === pos.kategoria);
      const preferowany = skladniki.get(pos.domyslnaSkladnikId) ?? kandydaci[0];
      if (!preferowany) continue;
      dodaj({ klucz: `kategoria:${pos.kategoria}`, ilosc: pos.ilosc, jednostka: pos.jednostka, kandydaci, preferowany });
    } else if (jestKomponentem(pos)) {
      const komponent = getComponentById(pos.komponentId);
      const proporcja = pos.ilosc / komponent.iloscWynikowa;
      for (const surowiec of komponent.skladniki) {
        prosty(surowiec.skladnikId, surowiec.ilosc * proporcja, surowiec.jednostka);
      }
    } else {
      prosty(pos.skladnikId, pos.ilosc, pos.jednostka);
    }
  }
  return [...wymagania.values()];
}

function zaokraglIlosc(ilosc: number, jednostka: string): number {
  if (jednostka === "szt") return Math.max(1, Math.round(ilosc));
  return ilosc < 10 ? Math.round(ilosc * 10) / 10 : Math.round(ilosc);
}

export function zaproponujDokupienie(opcje: {
  /** Id pozycji z koszyka (produkty z OFF nie pasują do żadnego przepisu i są pomijane same). */
  koszyk: string[];
  sloty: string[];
  restrykcje?: string[];
}): PropozycjeDokupienia {
  const restrykcje = opcje.restrykcje ?? [];
  const wszystkieSkladniki = getIngredients();
  const skladniki = new Map(wszystkieSkladniki.map((s) => [s.id, s]));
  const wKoszyku = new Set(opcje.koszyk);
  // Oleju nikt nie wpisuje do lodówki, a „dokup wodę" byłoby żartem — zapasy traktujemy jak posiadane.
  const mamy = (s: Ingredient) => wKoszyku.has(s.id) || s.zawszeWDomu === true;
  const dozwolony = (s: Ingredient) => !s.tagiAlergenow.some((t) => restrykcje.includes(t));

  const wszystkie: PropozycjaDokupienia[] = [];

  for (const przepis of getRecipes()) {
    if ((przepis.kategoriaDania ?? "glowne") !== "glowne") continue;
    if (!przepis.slot.some((s) => opcje.sloty.includes(s))) continue;

    const masz: string[] = [];
    const brakuje: BrakujacySkladnik[] = [];
    let wszystkich = 0;
    let odpada = false;

    for (const wymaganie of wymaganiaPrzepisu(przepis, skladniki, wszystkieSkladniki)) {
      const posiadany = wymaganie.kandydaci.find(mamy);
      if (posiadany?.zawszeWDomu && !wKoszyku.has(posiadany.id)) continue;
      wszystkich++;

      if (posiadany) {
        masz.push(posiadany.nazwa);
        continue;
      }

      // Nie podpowiadamy zakupu czegoś, czego user nie może jeść. Jeśli grupa ma dozwolony
      // zamiennik — proponujemy zamiennik; jeśli nie ma — przepis w ogóle odpada.
      const doKupienia = dozwolony(wymaganie.preferowany)
        ? wymaganie.preferowany
        : wymaganie.kandydaci.find(dozwolony);
      if (!doKupienia) {
        odpada = true;
        break;
      }
      const zamienniki = wymaganie.kandydaci
        .filter((s) => s.id !== doKupienia.id && dozwolony(s))
        .map((s) => s.nazwa);
      brakuje.push({
        id: doKupienia.id,
        nazwa: doKupienia.nazwa,
        ilosc: zaokraglIlosc(wymaganie.ilosc, wymaganie.jednostka),
        jednostka: wymaganie.jednostka,
        zamienniki: zamienniki.length > 0 ? zamienniki : undefined,
      });
    }

    // Brak braków = przepis jest wykonalny i siedzi już w puli planu dnia.
    // Zero trafień z koszyka = to nie jest „z lodówki", tylko zwykły przepis z bazy.
    if (odpada || brakuje.length === 0 || masz.length === 0) continue;

    wszystkie.push({
      recipeId: przepis.id,
      nazwa: przepis.nazwa,
      slot: przepis.slot,
      charakter: przepis.charakter,
      porcje: przepis.porcje,
      czasPrzygotowania: przepis.czasPrzygotowania,
      masz,
      brakuje,
      wszystkich,
      instrukcje: przepis.instrukcje,
    });
  }

  wszystkie.sort(
    (a, b) =>
      a.brakuje.length - b.brakuje.length ||
      b.masz.length / b.wszystkich - a.masz.length / a.wszystkich ||
      a.nazwa.localeCompare(b.nazwa, "pl")
  );

  const wyroznione = losujWazone(wszystkie.filter(wartyWyroznienia), ILE_WYROZNIONYCH).map((p) => p.recipeId);

  return { wyroznione, wszystkie };
}
