import { NextRequest, NextResponse } from "next/server";
import { getIngredients } from "@/lib/engine/data";
import type { Ingredient } from "@/lib/engine/types";

import type { Makro } from "@/lib/engine/types";

export interface SkladnikNaLiscie {
  id: string;
  nazwa: string;
  /** Tylko w trybie `lodowka` — kafelek dodaje pozycję do koszyka bez kolejnego zapytania. */
  makroNa100g?: Makro;
  masaSztuki?: number;
  tagiAlergenow?: string[];
  /** Silnik dokłada to sam — user nie musi dodawać do koszyka. */
  zawszeWDomu?: boolean;
}

export interface GrupaSkladnikow {
  grupa: string;
  skladniki: SkladnikNaLiscie[];
}

/**
 * Kategorie spiżarni dla trybu "z lodówki" — spłaszczenie 19 ról kulinarnych do 7 półek,
 * bo user szuka wzrokiem "gdzie jest nabiał", a nie "gdzie jest baza-kremowa".
 *
 * Grupujemy po `rolaKulinarna`, a NIE po `grupaPreferencji` (której używa krok lubię/nie lubię):
 * ta druga świadomie pomija m.in. odżywki białkowe i sosy, a one wypełniają gniazda szablonów,
 * więc w lodówce muszą być widoczne.
 */
const KATEGORIE_LODOWKI: { nazwa: string; role: string[] }[] = [
  { nazwa: "Pieczywo", role: ["pieczywo", "tortilla"] },
  { nazwa: "Mięso i wędliny", role: ["mieso", "wedlina"] },
  { nazwa: "Nabiał i jaja", role: ["jajko", "ser", "baza-kremowa", "jogurt", "mleko"] },
  { nazwa: "Kasze, ryż, płatki", role: ["platki", "kasza-ryz", "ziemniaki"] },
  { nazwa: "Warzywa", role: ["warzywo"] },
  { nazwa: "Owoce", role: ["owoc"] },
  { nazwa: "Dodatki", role: ["dodatek-slodki", "posypka", "tluszcz", "sos", "odzywka"] },
];

function wgKategoriiLodowki(skladniki: Ingredient[]): GrupaSkladnikow[] {
  return KATEGORIE_LODOWKI.map(({ nazwa, role }) => ({
    grupa: nazwa,
    skladniki: skladniki
      .filter((s) => s.rolaKulinarna !== undefined && role.includes(s.rolaKulinarna))
      .map((s) => ({
        id: s.id,
        nazwa: s.nazwa,
        makroNa100g: s.makroNa100g,
        masaSztuki: s.masaSztuki,
        tagiAlergenow: s.tagiAlergenow,
        zawszeWDomu: s.zawszeWDomu,
      })),
  })).filter((g) => g.skladniki.length > 0);
}

function wgGrupPreferencji(skladniki: Ingredient[]): GrupaSkladnikow[] {
  const grupy = new Map<string, GrupaSkladnikow>();
  for (const skladnik of skladniki) {
    if (!skladnik.grupaPreferencji) continue;
    const wpis = { id: skladnik.id, nazwa: skladnik.nazwa };
    const istniejaca = grupy.get(skladnik.grupaPreferencji);
    if (istniejaca) istniejaca.skladniki.push(wpis);
    else grupy.set(skladnik.grupaPreferencji, { grupa: skladnik.grupaPreferencji, skladniki: [wpis] });
  }
  return [...grupy.values()];
}

/**
 * Lista składników do wyboru, pogrupowana. Dwa tryby, bo dwa kroki formularza pytają
 * o co innego:
 * - `preferencje` (domyślny) — krok "lubię / nie jem tego", grupy z `grupaPreferencji`,
 * - `lodowka` — picker spiżarni, kategorie z `rolaKulinarna`.
 *
 * Kolejność w obu bierze się z kolejności wpisów w ingredients.json — to tam się ją zmienia.
 */
export async function GET(request: NextRequest) {
  const grupowanie = new URL(request.url).searchParams.get("grupowanie");
  const skladniki = getIngredients();
  const grupy = grupowanie === "lodowka" ? wgKategoriiLodowki(skladniki) : wgGrupPreferencji(skladniki);
  return NextResponse.json({ grupy });
}
