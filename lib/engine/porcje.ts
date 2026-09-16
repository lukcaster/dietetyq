import type { Makro } from "./types";

/**
 * Sufity kulinarne i granice dla solvera — wspólne dla trybu „z lodówki" i dla „gotowców"
 * w planie tygodniowym.
 *
 * Moduł powstał przez wyciągnięcie tego kodu z `z-lodowki.ts`: obie ścieżki składają posiłek
 * z luźnych składników, więc muszą obowiązywać w nich te same limity. Druga kopia tych liczb
 * rozjechałaby się przy pierwszej korekcie.
 */

export type JednostkaPorcji = "g" | "szt";

export const KROK_JEDNOSTKI: Record<JednostkaPorcji, number> = { g: 5, szt: 1 };

/**
 * Ile najwyżej danego składnika w JEDNYM posiłku, gdy nie ma limitu z zapasu (w gramach).
 * Bez tego solver dobija kcal czym popadnie i wychodzi 400 g ogórka albo 90 g oliwy —
 * matematycznie poprawne, kulinarnie bez sensu.
 */
export const SUFIT_ROLI: Record<string, number> = {
  pieczywo: 150,
  wedlina: 100,
  mieso: 250,
  jajko: 250,
  ser: 60,
  "baza-kremowa": 300,
  jogurt: 400,
  mleko: 400,
  platki: 120,
  "kasza-ryz": 120,
  // Makaron i strączki mają własne role (osobno od kaszy), bo do ryżu na mleku pasuje kasza,
  // a nie soczewica — ale sufit na sucho jest ten sam rząd wielkości.
  makaron: 125,
  straczne: 100,
  ziemniaki: 400,
  warzywo: 200,
  owoc: 250,
  "dodatek-slodki": 40,
  posypka: 30,
  tluszcz: 25,
  sos: 50,
  odzywka: 60,
};

/** Produkty z OFF i składniki bez roli kulinarnej — nie wiemy, czym są, więc ostrożnie. */
export const SUFIT_DOMYSLNY = 200;
export const SUFIT_SZTUK = 6;

/** Poniżej tylu gramów pozycja jest okruchem, nie składnikiem — wypada z posiłku. */
export const MIN_SENSOWNA_PORCJA_G = 15;

/**
 * Sufity wyżej są podane dla „przeciętnego" posiłku ~600 kcal i skalują się z celem slotu:
 * 250 g mięsa jest sensowne na obiad 600 kcal, ale na obiad 1200 kcal to już za mało.
 * Mnożnik jest przycięty, żeby przy skrajnych celach nie wyszło 900 g piersi ani 40 g ryżu.
 */
const KCAL_REFERENCYJNE_POSILKU = 600;
const MIN_MNOZNIK_SUFITU = 0.6;
const MAKS_MNOZNIK_SUFITU = 2;

export function mnoznikSufitu(celSlotu: Makro): number {
  const surowy = celSlotu.kcal / KCAL_REFERENCYJNE_POSILKU;
  return Math.min(MAKS_MNOZNIK_SUFITU, Math.max(MIN_MNOZNIK_SUFITU, surowy));
}

/** Przelicza gramy z bazy na jednostkę, w której trzymamy tę pozycję. */
export function naJednostke(
  gramy: number | undefined,
  jednostka: JednostkaPorcji,
  masaSztuki?: number
): number | undefined {
  if (gramy === undefined) return undefined;
  if (jednostka !== "szt") return gramy;
  return masaSztuki ? gramy / masaSztuki : undefined;
}

export interface GranicePozycji {
  min: number;
  max: number;
  krok: number;
  start: number;
  preferowana?: number;
}

/**
 * Granice jednej pozycji dla solvera — wspólne dla planowania dnia, ręcznego przeliczania
 * i gotowców, żeby wszędzie obowiązywały te same sufity kulinarne.
 */
export function granicePozycji(opcje: {
  rola?: string;
  jednostka: JednostkaPorcji;
  celSlotu: Makro;
  /** Limit wynikający z zadeklarowanego zapasu, już podzielony między posiłki. */
  limitZZapasu?: number;
  /** Składnik z wymaganego gniazda szablonu — ma zagwarantowaną minimalną porcję. */
  wRdzeniu: boolean;
  /** `maksPorcja` składnika, przeliczona na jednostkę pozycji. Nadpisuje sufit roli. */
  sufitSkladnika?: number;
  /** `porcjaTypowa` składnika, przeliczona na jednostkę pozycji. */
  porcjaTypowa?: number;
}): GranicePozycji {
  const { rola, jednostka, celSlotu, limitZZapasu, wRdzeniu, sufitSkladnika, porcjaTypowa } = opcje;
  const zRoli = jednostka === "szt" ? SUFIT_SZTUK : (rola !== undefined ? SUFIT_ROLI[rola] : undefined) ?? SUFIT_DOMYSLNY;
  // Sufit roli skaluje się z wielkością posiłku (250 g mięsa na obiad 600 kcal, więcej na 1200),
  // ale sufit składnika NIE: jest ustawiony tam, gdzie rola kłamie, a 60 g cebuli to 60 g cebuli
  // niezależnie od tego, jak duży jest obiad.
  const bazowySufit = sufitSkladnika ?? zRoli * mnoznikSufitu(celSlotu);
  const surowySufit = Math.min(limitZZapasu ?? Infinity, bazowySufit);

  // Sufit musi być wielokrotnością kroku, inaczej solver opiera się o limit i zwraca
  // "458,33 g mleka" — nikt tego nie odmierzy.
  const krok = KROK_JEDNOSTKI[jednostka];
  // Podłoga "przynajmniej jeden krok" jest po to, żeby pozycja bez zadeklarowanego zapasu
  // nie dostała sufitu 0. Gdy zapas JEST podany, tej podłogi być nie może: przy jednym jajku
  // dzielonym na dwa posiłki podnosiła 0,5 szt do 1 szt w każdym i wychodziły dwa jajka z jednego.
  const podloga = limitZZapasu !== undefined ? 0 : krok;
  const max = Math.max(podloga, Math.floor(surowySufit / krok) * krok);
  // Składnik z wymaganego gniazda musi wystąpić w sensownej ilości — inaczej wychodzi
  // "owsianka" złożona z samego jogurtu, bo płatki zeszły do 5 g.
  const min = wRdzeniu ? Math.min(max, jednostka === "szt" ? 1 : MIN_SENSOWNA_PORCJA_G) : 0;

  // Porcja typowa jest dla solvera tylko wskazówką, ale musi mieścić się w granicach —
  // inaczej ciągnęłaby poza to, co user w ogóle ma w lodówce.
  const preferowana = porcjaTypowa !== undefined ? Math.min(max, Math.max(min, porcjaTypowa)) : undefined;

  return { min, max, krok, start: preferowana ?? Math.min(jednostka === "szt" ? 1 : 100, max), preferowana };
}
