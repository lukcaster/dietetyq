import { getIngredients, getProdukty } from "./data";
import { PREFIKS_PRODUKTU, type Ingredient, type PozycjaSpizarni, type Produkt } from "./types";

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

export function znajdzPozycjeSpizarni(id: string): PozycjaSpizarni | null {
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

export function szukajWSpizarni(fraza: string, opcje: OpcjeWyszukiwania = {}): PozycjaSpizarni[] {
  const { limit = DOMYSLNY_LIMIT, restrykcje = [], dopuscNieznaneAlergeny = false, tylkoBaza = false } = opcje;
  const szukane = znormalizuj(fraza);
  const slowa = szukane.split(" ").filter(Boolean);

  const kandydaci: { pozycja: PozycjaSpizarni; popularnosc: number }[] = getIngredients().map((s) => ({
    pozycja: zeSkladnika(s),
    popularnosc: 0,
  }));

  if (!tylkoBaza) {
    for (const produkt of getProdukty()) {
      kandydaci.push({ pozycja: zProduktu(produkt), popularnosc: produkt.popularnosc });
    }
  }

  const dopasowane = kandydaci.filter(({ pozycja }) => {
    if (maZakazanyAlergen(pozycja, restrykcje)) return false;
    if (pozycja.alergenyNieznane && restrykcje.length > 0 && !dopuscNieznaneAlergeny) return false;
    if (slowa.length === 0) return true;
    const stog = znormalizuj(`${pozycja.nazwa} ${pozycja.marka ?? ""}`);
    return slowa.every((slowo) => stog.includes(slowo));
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
  let punkty = pozycja.zrodlo === "baza" ? 10_000 : 0;
  const nazwa = znormalizuj(pozycja.nazwa);
  if (szukane.length > 0) {
    if (nazwa === szukane) punkty += 5_000;
    else if (nazwa.startsWith(szukane)) punkty += 2_000;
  }
  if (pozycja.alergenyNieznane) punkty -= 500;
  return punkty + Math.log10(popularnosc + 1) * 100;
}
