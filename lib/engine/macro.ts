import { getIngredientById, getIngredients, getComponentById } from "./data";
import {
  jestKomponentem,
  jestGrupaWyboru,
  type Makro,
  type Ingredient,
  type SkladnikPozycja,
  type SkladnikProsty,
  type Recipe,
} from "./types";

/**
 * Czego user nie chce mieć na talerzu. Dwa powody, jeden mechanizm odrzucania:
 * - `alergeny` — nie MOŻE zjeść (dopasowanie po `tagiAlergenow`),
 * - `nielubiane` — nie CHCE zjeść (dopasowanie po `id` składnika).
 *
 * Silnik traktuje oba tak samo (grupa wyboru podstawia zamiennik, a przepis bez wyjścia
 * jest niewykonalny), bo z punktu widzenia doboru przepisu to ta sama operacja.
 */
export interface FiltrSkladnikow {
  alergeny: string[];
  nielubiane: string[];
}

export function zbudujFiltr(alergeny: string[] = [], nielubiane: string[] = []): FiltrSkladnikow {
  return { alergeny, nielubiane };
}

/** Pusty filtr — nic nie jest odrzucane. */
export const BEZ_FILTRA: FiltrSkladnikow = { alergeny: [], nielubiane: [] };

export function skladnikOdrzucony(skladnik: Ingredient, filtr: FiltrSkladnikow): boolean {
  if (filtr.nielubiane.includes(skladnik.id)) return true;
  return skladnik.tagiAlergenow.some((tag) => filtr.alergeny.includes(tag));
}

export function pustaMakro(): Makro {
  return { kcal: 0, bialko: 0, tluszcz: 0, wegle: 0 };
}

export function dodajMakro(a: Makro, b: Makro): Makro {
  return {
    kcal: a.kcal + b.kcal,
    bialko: a.bialko + b.bialko,
    tluszcz: a.tluszcz + b.tluszcz,
    wegle: a.wegle + b.wegle,
  };
}

export function skalujMakro(m: Makro, mnoznik: number): Makro {
  return {
    kcal: m.kcal * mnoznik,
    bialko: m.bialko * mnoznik,
    tluszcz: m.tluszcz * mnoznik,
    wegle: m.wegle * mnoznik,
  };
}

/** Masa w gramach dla podanej ilości — uwzględnia jednostkę "szt" (masaSztuki). */
export function masaWGramach(skladnik: Ingredient, ilosc: number, jednostka: string): number {
  if (jednostka === "szt") {
    if (!skladnik.masaSztuki) {
      throw new Error(`Składnik ${skladnik.id} nie ma zdefiniowanej masaSztuki, a użyto jednostki "szt"`);
    }
    return ilosc * skladnik.masaSztuki;
  }
  return ilosc;
}

export function makroSkladnikaProstego(pos: SkladnikProsty): Makro {
  const skladnik = getIngredientById(pos.skladnikId);
  const gramy = masaWGramach(skladnik, pos.ilosc, pos.jednostka);
  return skalujMakro(skladnik.makroNa100g, gramy / 100);
}

export function makroKomponentu(komponentId: string): Makro {
  const komponent = getComponentById(komponentId);
  return komponent.skladniki.reduce((suma, pos) => dodajMakro(suma, makroSkladnikaProstego(pos)), pustaMakro());
}

/** Czy komponent zawiera (w swoich surowych składnikach) coś odrzuconego przez filtr. */
export function komponentMaZakazanySkladnik(komponentId: string, filtr: FiltrSkladnikow): boolean {
  if (filtr.alergeny.length === 0 && filtr.nielubiane.length === 0) return false;
  const komponent = getComponentById(komponentId);
  return komponent.skladniki.some((pos) => skladnikOdrzucony(getIngredientById(pos.skladnikId), filtr));
}

/**
 * Wybiera składnik z danej kategorii zamienników (ingredients.json -> pole "kategoria"),
 * odrzucając te odrzucone przez filtr. Preferuje domyślny wybór TEGO przepisu, jeśli jest dopuszczalny.
 * Zwraca null jeśli żaden składnik z kategorii nie jest dopuszczalny.
 */
export function wybierzZKategorii(kategoria: string, domyslnaSkladnikId: string, filtr: FiltrSkladnikow): string | null {
  const dopuszczalne = getIngredients().filter(
    (skladnik) => skladnik.kategoria === kategoria && !skladnikOdrzucony(skladnik, filtr)
  );
  if (dopuszczalne.length === 0) return null;
  const domyslny = dopuszczalne.find((s) => s.id === domyslnaSkladnikId);
  return (domyslny ?? dopuszczalne[0]).id;
}

export interface RozwiazanaPozycja {
  skladnikId: string;
  ilosc: number;
  jednostka: string;
  nazwaWyswietlana: string;
  makro: Makro;
  /** Nazwa składnika, który tu pierwotnie był, gdy musieliśmy go podmienić przez filtr. */
  zamiast?: string;
}

/**
 * Składnik zastępczy dla odrzuconego przez filtr — z tej samej kategorii zamienników.
 *
 * Przedtem każdy zakazany składnik kasował cały przepis i przy „bez laktozy" znikała jedna
 * trzecia bazy, a przy „bez glutenu" ponad połowa — tylko dlatego, że w omlecie jest ser,
 * a do dania podano chleb pszenny. Przepis zostaje, a ser wymieniamy na bezlaktozowy.
 *
 * Świadomie NIE podmieniamy wszystkiego: jajko nie ma kategorii zamienników, bo omlet bez
 * jajka to nie omlet z zamiennikiem, tylko inne danie. Granicę wyznacza pole `kategoria`
 * w ingredients.json — jak czegoś tam nie ma, przepis nadal wypada i to jest poprawne.
 */
function zamiennikDla(skladnik: Ingredient, jednostka: string, filtr: FiltrSkladnikow): Ingredient | null {
  if (!skladnik.kategoria) return null;
  const zamiennikId = wybierzZKategorii(skladnik.kategoria, skladnik.id, filtr);
  if (!zamiennikId || zamiennikId === skladnik.id) return null;
  const zamiennik = getIngredientById(zamiennikId);
  // "2 szt pity" nie przeliczy się na chleb bezglutenowy sprzedawany na wagę — masaWGramach
  // by na tym poległ, a my wolimy w takim wypadku uczciwie odrzucić przepis.
  if (jednostka === "szt" && !zamiennik.masaSztuki) return null;
  return zamiennik;
}

/**
 * Rozwiązuje jedną pozycję składników przepisu/komponentu do konkretnego składnika + makro,
 * uwzględniając filtr usera (wybór z grupy, ewentualny brak dopuszczalnej opcji).
 * Zwraca null jeśli pozycja jest niemożliwa do zrealizowania (wszystkie opcje odrzucone).
 */
export function rozwiazPozycje(pos: SkladnikPozycja, filtr: FiltrSkladnikow): RozwiazanaPozycja | null {
  if (jestGrupaWyboru(pos)) {
    const wybranyId = wybierzZKategorii(pos.kategoria, pos.domyslnaSkladnikId, filtr);
    if (!wybranyId) return null;
    const skladnik = getIngredientById(wybranyId);
    const gramy = masaWGramach(skladnik, pos.ilosc, pos.jednostka);
    return {
      skladnikId: wybranyId,
      ilosc: pos.ilosc,
      jednostka: pos.jednostka,
      nazwaWyswietlana: skladnik.nazwa,
      makro: skalujMakro(skladnik.makroNa100g, gramy / 100),
    };
  }

  if (jestKomponentem(pos)) {
    if (komponentMaZakazanySkladnik(pos.komponentId, filtr)) return null;
    const komponent = getComponentById(pos.komponentId);
    const makroCalegoKomponentu = makroKomponentu(pos.komponentId);
    const proporcja = pos.ilosc / komponent.iloscWynikowa;
    return {
      skladnikId: pos.komponentId,
      ilosc: pos.ilosc,
      jednostka: pos.jednostka,
      nazwaWyswietlana: komponent.nazwa,
      makro: skalujMakro(makroCalegoKomponentu, proporcja),
    };
  }

  const oryginal = getIngredientById(pos.skladnikId);
  let skladnik = oryginal;
  let zamiast: string | undefined;
  if (skladnikOdrzucony(oryginal, filtr)) {
    const zamiennik = zamiennikDla(oryginal, pos.jednostka, filtr);
    if (!zamiennik) return null;
    skladnik = zamiennik;
    zamiast = oryginal.nazwa;
  }

  const gramy = masaWGramach(skladnik, pos.ilosc, pos.jednostka);
  return {
    skladnikId: skladnik.id,
    ilosc: pos.ilosc,
    jednostka: pos.jednostka,
    nazwaWyswietlana: skladnik.nazwa,
    makro: skalujMakro(skladnik.makroNa100g, gramy / 100),
    zamiast,
  };
}

export interface SkladnikBazowy {
  skladnikId: string;
  ilosc: number;
  jednostka: string;
}

/**
 * Rozwija pozycję do listy "kupowalnych" składników bazowych — komponenty (np. ciasto)
 * są rozbijane na swoje surowe składniki, żeby lista zakupów miała sens w sklepie.
 * Zwraca null jeśli pozycja jest niemożliwa do zrealizowania przy danym filtrze.
 */
export function rozwinDoBazowychSkladnikow(pos: SkladnikPozycja, filtr: FiltrSkladnikow): SkladnikBazowy[] | null {
  if (jestGrupaWyboru(pos)) {
    const wybranyId = wybierzZKategorii(pos.kategoria, pos.domyslnaSkladnikId, filtr);
    if (!wybranyId) return null;
    return [{ skladnikId: wybranyId, ilosc: pos.ilosc, jednostka: pos.jednostka }];
  }
  if (jestKomponentem(pos)) {
    if (komponentMaZakazanySkladnik(pos.komponentId, filtr)) return null;
    const komponent = getComponentById(pos.komponentId);
    const proporcja = pos.ilosc / komponent.iloscWynikowa;
    return komponent.skladniki.map((s) => ({
      skladnikId: s.skladnikId,
      ilosc: s.ilosc * proporcja,
      jednostka: s.jednostka,
    }));
  }
  const oryginal = getIngredientById(pos.skladnikId);
  if (!skladnikOdrzucony(oryginal, filtr)) {
    return [{ skladnikId: pos.skladnikId, ilosc: pos.ilosc, jednostka: pos.jednostka }];
  }
  // Na liście zakupów musi wylądować to, co user naprawdę kupi — czyli zamiennik.
  const zamiennik = zamiennikDla(oryginal, pos.jednostka, filtr);
  if (!zamiennik) return null;
  return [{ skladnikId: zamiennik.id, ilosc: pos.ilosc, jednostka: pos.jednostka }];
}

export interface RozwiazanyPrzepis {
  pozycje: RozwiazanaPozycja[];
  makroCalkowite: Makro;
  makroNaPorcje: Makro;
}

/** Rozwiązuje cały przepis (wszystkie pozycje) względem filtru. Zwraca null jeśli przepis jest niewykonalny. */
export function rozwiazPrzepis(recipe: Recipe, filtr: FiltrSkladnikow): RozwiazanyPrzepis | null {
  const pozycje: RozwiazanaPozycja[] = [];
  for (const pos of recipe.skladniki) {
    const rozwiazana = rozwiazPozycje(pos, filtr);
    if (!rozwiazana) return null;
    pozycje.push(rozwiazana);
  }
  const makroCalkowite = pozycje.reduce((suma, p) => dodajMakro(suma, p.makro), pustaMakro());
  return {
    pozycje,
    makroCalkowite,
    makroNaPorcje: skalujMakro(makroCalkowite, 1 / recipe.porcje),
  };
}
