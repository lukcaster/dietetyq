import { getComponents, getIngredients, getProdukty } from "./data";
import { makroKomponentu } from "./macro";
import {
  PREFIKS_KOMPONENTU,
  PREFIKS_PRODUKTU,
  type Component,
  type Ingredient,
  type PozycjaSpizarni,
  type Produkt,
} from "./types";

/**
 * "Spiżarnia" to wspólny widok na dwa źródła, z których user może budować własny posiłek:
 * kuratorowane składniki z ingredients.json (surowce: pierś z kurczaka, ryż, oliwa) oraz
 * produkty sklepowe zaimportowane z Open Food Facts (konkretne marki, kod kreskowy).
 *
 * Rozdział jest celowy i widoczny w id: składnik bazowy ma zwykłe id, produkt ma prefiks "off:".
 * Dzięki temu z samego id wiadomo, czy makro pochodzi z kuratorowanej bazy (pewne),
 * czy z crowdsourcowanego OFF (mniej pewne, alergeny mogą być nieuzupełnione).
 */

function znormalizuj(tekst: string): string {
  return tekst
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function zeSkladnika(skladnik: Ingredient): PozycjaSpizarni {
  return {
    id: skladnik.id,
    nazwa: skladnik.nazwa,
    makroNa100g: skladnik.makroNa100g,
    tagiAlergenow: skladnik.tagiAlergenow,
    alergenyNieznane: false,
    masaSztuki: skladnik.masaSztuki,
    rolaKulinarna: skladnik.rolaKulinarna,
    porcjaTypowa: skladnik.porcjaTypowa,
    maksPorcja: skladnik.maksPorcja,
    zrodlo: "baza",
  };
}

function zProduktu(produkt: Produkt): PozycjaSpizarni {
  return {
    id: `${PREFIKS_PRODUKTU}${produkt.kod}`,
    nazwa: produkt.nazwa,
    marka: produkt.marka,
    makroNa100g: produkt.makroNa100g,
    tagiAlergenow: produkt.tagiAlergenow,
    alergenyNieznane: produkt.alergenyNieznane,
    zrodlo: "off",
  };
}

/**
 * Komponent widziany jak zwykły składnik: makro przeliczone z jego składu na 100 g,
 * alergeny zebrane ze wszystkich surowców.
 */
function zKomponentu(komponent: Component): PozycjaSpizarni {
  const calosc = makroKomponentu(komponent.id);
  const naSto = komponent.iloscWynikowa > 0 ? 100 / komponent.iloscWynikowa : 0;
  const alergeny = new Set<string>();
  for (const surowiec of komponent.skladniki) {
    const skladnik = getIngredients().find((s) => s.id === surowiec.skladnikId);
    for (const tag of skladnik?.tagiAlergenow ?? []) alergeny.add(tag);
  }
  return {
    id: `${PREFIKS_KOMPONENTU}${komponent.id}`,
    nazwa: komponent.nazwa,
    makroNa100g: {
      kcal: calosc.kcal * naSto,
      bialko: calosc.bialko * naSto,
      tluszcz: calosc.tluszcz * naSto,
      wegle: calosc.wegle * naSto,
    },
    tagiAlergenow: [...alergeny],
    alergenyNieznane: false,
    masaSztuki: komponent.masaSztuki,
    /*
     * Bez tego komponent trafiał na SUFIT_DOMYSLNY (200 g — tyle, ile dostaje nieznany produkt
     * z OFF) i solver ścinał ciasto naleśnikowe do 205 g, czyli poniżej trzech naleśników.
     * Naturalny sufit półproduktu to jedna zrobiona porcja: więcej znaczy "zrób drugie ciasto".
     */
    maksPorcja: komponent.iloscWynikowa,
    porcjaTypowa: komponent.porcjaTypowa,
    zrodlo: "komponent",
  };
}

export function znajdzPozycjeSpizarni(id: string): PozycjaSpizarni | null {
  if (id.startsWith(PREFIKS_KOMPONENTU)) {
    const komponentId = id.slice(PREFIKS_KOMPONENTU.length);
    const komponent = getComponents().find((k) => k.id === komponentId);
    return komponent ? zKomponentu(komponent) : null;
  }
  if (id.startsWith(PREFIKS_PRODUKTU)) {
    const kod = id.slice(PREFIKS_PRODUKTU.length);
    const produkt = getProdukty().find((p) => p.kod === kod);
    return produkt ? zProduktu(produkt) : null;
  }
  const skladnik = getIngredients().find((s) => s.id === id);
  return skladnik ? zeSkladnika(skladnik) : null;
}

export function pobierzPozycjeSpizarni(id: string): PozycjaSpizarni {
  const pozycja = znajdzPozycjeSpizarni(id);
  if (!pozycja) throw new Error(`Nieznana pozycja spiżarni: ${id}`);
  return pozycja;
}

export function maZakazanyAlergen(pozycja: PozycjaSpizarni, restrykcje: string[]): boolean {
  return pozycja.tagiAlergenow.some((tag) => restrykcje.includes(tag));
}

export interface OpcjeWyszukiwania {
  limit?: number;
  restrykcje?: string[];
  /**
   * Produkty z OFF bez uzupełnionych alergenów są przy aktywnych restrykcjach domyślnie
   * ukrywane — brak tagu w OFF nie znaczy "bezpieczny", a cicho przepuszczony produkt mleczny
   * u kogoś z nietolerancją to najgorszy możliwy błąd tej aplikacji. UI może je odblokować świadomie.
   */
  dopuscNieznaneAlergeny?: boolean;
  /** Pomija produkty z OFF — przydatne, gdy chcemy tylko kuratorowanych surowców. */
  tylkoBaza?: boolean;
}

const DOMYSLNY_LIMIT = 25;

/**
 * Ile znaków wspólnego początku wystarczy, żeby uznać dwa słowa za to samo mimo odmiany.
 * Polski odmienia końcówki, a nie rdzenie: "naleśniki" vs "naleśnikowe" dzielą 8 znaków,
 * "ciasto" vs "ciasta" — tylko 5, więc niżej zejść się nie da.
 *
 * Ceną są pojedyncze pudła na ogonie listy ("ziemniaki" złapie "orzeszki ziemne" — wspólne
 * "ziemn"). Świadomie to przyjmujemy: wynik za dużo jest o klasę tańszy niż brak wyniku,
 * bo trafne dopasowania i tak stoją wyżej w punktacji.
 */
const WSPOLNY_RDZEN = 5;

/**
 * Dopasowanie słowa do słowa z nazwy. Samo `includes` na całej nazwie gubiło odmiany:
 * user szukał "naleśniki", a ciasto nazywa się "Ciasto naleśnikowe z soczewicy" — zero wyników,
 * więc półprodukty wyglądały, jakby ich w ogóle nie było w bazie.
 */
function pasujeSlowo(szukane: string, wNazwie: string): boolean {
  if (wNazwie.startsWith(szukane)) return true;
  // Odwrotny kierunek tylko dla sensownych słów: gdyby "z" z "z soczewicy" liczyło się
  // jako dopasowanie, każde zapytanie na "z" pasowałoby do połowy bazy.
  if (wNazwie.length >= 3 && szukane.startsWith(wNazwie)) return true;
  let wspolne = 0;
  while (wspolne < szukane.length && wspolne < wNazwie.length && szukane[wspolne] === wNazwie[wspolne]) wspolne++;
  return wspolne >= WSPOLNY_RDZEN;
}

export function szukajWSpizarni(fraza: string, opcje: OpcjeWyszukiwania = {}): PozycjaSpizarni[] {
  const { limit = DOMYSLNY_LIMIT, restrykcje = [], dopuscNieznaneAlergeny = false, tylkoBaza = false } = opcje;
  const szukane = znormalizuj(fraza);
  const slowa = szukane.split(" ").filter(Boolean);

  const kandydaci: { pozycja: PozycjaSpizarni; popularnosc: number }[] = getIngredients().map((s) => ({
    pozycja: zeSkladnika(s),
    popularnosc: 0,
  }));

  // Ciasta i inne półprodukty — user i tak je robi, więc powinien móc z nich budować posiłek.
  for (const komponent of getComponents()) {
    kandydaci.push({ pozycja: zKomponentu(komponent), popularnosc: 0 });
  }

  if (!tylkoBaza) {
    for (const produkt of getProdukty()) {
      kandydaci.push({ pozycja: zProduktu(produkt), popularnosc: produkt.popularnosc });
    }
  }

  const dopasowane = kandydaci.filter(({ pozycja }) => {
    if (maZakazanyAlergen(pozycja, restrykcje)) return false;
    if (pozycja.alergenyNieznane && restrykcje.length > 0 && !dopuscNieznaneAlergeny) return false;
    if (slowa.length === 0) return true;
    const stog = znormalizuj(`${pozycja.nazwa} ${pozycja.marka ?? ""}`).split(" ").filter(Boolean);
    return slowa.every((slowo) => stog.some((slowoStogu) => pasujeSlowo(slowo, slowoStogu)));
  });

  return dopasowane
    .map((k) => ({ ...k, punkty: punktacja(k.pozycja, k.popularnosc, szukane) }))
    .sort((a, b) => b.punkty - a.punkty || a.pozycja.nazwa.localeCompare(b.pozycja.nazwa, "pl"))
    .slice(0, limit)
    .map((k) => k.pozycja);
}

/**
 * Kuratorowane surowce idą przed produktami sklepowymi — mają pewniejsze makro i pasują
 * do przepisów. Wśród produktów decyduje trafność nazwy, a przy remisie popularność w OFF.
 */
function punktacja(pozycja: PozycjaSpizarni, popularnosc: number, szukane: string): number {
  // Komponenty idą razem z bazą: to nasze własne, policzone receptury, a nie crowdsourcowany OFF.
  // Z zerową punktacją tonęły pod produktami sklepowymi i nie mieściły się w limicie wyników.
  let punkty = pozycja.zrodlo === "off" ? 0 : 10_000;
  const nazwa = znormalizuj(pozycja.nazwa);
  if (szukane.length > 0) {
    if (nazwa === szukane) punkty += 5_000;
    else if (nazwa.startsWith(szukane)) punkty += 2_000;
  }
  if (pozycja.alergenyNieznane) punkty -= 500;
  return punkty + Math.log10(popularnosc + 1) * 100;
}
