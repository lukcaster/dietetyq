export interface Makro {
  kcal: number;
  bialko: number;
  tluszcz: number;
  wegle: number;
}

/**
 * Mikroskładniki na 100 g. Świadomie NIE są częścią `Makro`: solver optymalizuje gramatury
 * po czterech celach z `Makro` i gdyby żelazo stało się piątym, zaczynałby dosypywać szpinak,
 * żeby dobić normę. Mikro jest warstwą raportującą, nie optymalizacyjną — liczymy po fakcie.
 *
 * Jednostki: błonnik w gramach, reszta w miligramach.
 */
export interface Mikro {
  blonnik: number;
  zelazo: number;
  wapn: number;
  magnez: number;
  potas: number;
  cynk: number;
  witaminaC: number;
  sod: number;
}

export interface Ingredient {
  id: string;
  nazwa: string;
  makroNa100g: Makro;
  /** Brak = składnika nie policzymy do bilansu (patrz `pokrycieMasy` w mikro.ts). */
  mikroNa100g?: Mikro;
  tagiAlergenow: string[];
  masaSztuki?: number;
  /** Kategoria zamienników (np. "mleko", "jogurt") — łączy składniki, które mogą zastąpić się
   * nawzajem w przepisie. Patrz GrupaWyboru. */
  kategoria?: string;
  /**
   * Nagłówek sekcji w kroku "lubię / nie lubię" (np. "Mięso i wędliny"). Ustawiony tylko dla
   * składników, o które ma sens zapytać — erytrytol czy drożdże to detal przepisu, nie preferencja.
   */
  grupaPreferencji?: string;
  /**
   * Do jakiego gniazda w szablonie dania składnik może wejść (np. "pieczywo", "wedlina", "owoc").
   * Oś zupełnie inna niż `kategoria` (zamienniki 1:1 wewnątrz przepisu) — patrz data/szablony.json.
   * Brak = składnik nie tworzy posiłku sam z siebie (mąka, drożdże, cytryna).
   */
  rolaKulinarna?: string;
  /**
   * Ile tego człowiek normalnie nakłada sobie na talerz, w gramach. Nie jest to ani minimum,
   * ani maksimum — to punkt, ku któremu solver ciąży, gdy makro mu na to pozwala (patrz
   * WAGA_TYPOWEJ_PORCJI w solver.ts). Bez tego składniki obojętne dla makro (ogórek, sałata)
   * lądowały na krańcach przedziału: 200 g ogórka w kanapce albo 15 g borówek przy 250 g
   * w koszyku. Brak = solver nie ma zdania o porcji tego składnika.
   */
  porcjaTypowa?: number;
  /**
   * Twardy sufit na jedną porcję, w gramach — nadpisuje sufit wynikający z roli kulinarnej.
   * Potrzebny tam, gdzie rola kłamie: cebula ma rolę "warzywo" (i sufit 200 g), bo ma trafiać
   * do gniazd na warzywa, ale 135 g cebuli w daniu to nie jest porcja warzyw, tylko pomyłka.
   * W przeciwieństwie do porcjaTypowa tego solver nie może przekroczyć.
   */
  maksPorcja?: number;
  /**
   * Rzecz, którą każdy ma w domu (olej, oliwa) — tryb "z lodówki" dokłada ją do koszyka sam.
   * Nikt nie wpisuje oleju do lodówki, a bez niego szablon jajecznicy zwracał samo jajko
   * ze szpinakiem: gniazdo tłuszczu było opcjonalne i nie miało czym się wypełnić.
   */
  zawszeWDomu?: boolean;
}

/** Jedno gniazdo w szablonie dania — "coś na wierzch kanapki", "skrobia do dania na ciepło". */
export interface GniazdoSzablonu {
  etykieta: string;
  /** Role kulinarne składników, które mogą wypełnić to gniazdo (alternatywy). */
  role: string[];
  /** Bez wypełnienia tego gniazda szablonu nie da się złożyć. */
  wymagane: boolean;
  /** Ile najwyżej składników może tu wejść (domyślnie 1) — np. 3 warzywa do sałatki. */
  ile?: number;
}

/**
 * Archetyp dania: "kanapka", "owsianka", "danie na ciepło". Nie przepis — szablon ma gniazda
 * na role, nie na konkretne składniki, więc jeden szablon pokrywa setki kombinacji.
 * To on pilnuje, żeby szynka trafiła do pieczywa, a nie do ryżu z mlekiem.
 */
export interface SzablonDania {
  id: string;
  nazwa: string;
  sloty: string[];
  gniazda: GniazdoSzablonu[];
}

export interface SkladnikProsty {
  skladnikId: string;
  ilosc: number;
  jednostka: string;
}

export interface SkladnikKomponent {
  komponentId: string;
  ilosc: number;
  jednostka: string;
}

export interface GrupaWyboru {
  nazwaGrupy: string;
  ilosc: number;
  jednostka: string;
  /** Kategoria składników z ingredients.json (pole "kategoria"), z których silnik wybiera. */
  kategoria: string;
  /** Domyślny wybór TEGO przepisu w tej pozycji (gdy nie jest zakazany alergenem). */
  domyslnaSkladnikId: string;
}

export type SkladnikPozycja = SkladnikProsty | SkladnikKomponent | GrupaWyboru;

export function jestKomponentem(pos: SkladnikPozycja): pos is SkladnikKomponent {
  return "komponentId" in pos;
}

export function jestGrupaWyboru(pos: SkladnikPozycja): pos is GrupaWyboru {
  return "kategoria" in pos;
}

export interface Component {
  id: string;
  nazwa: string;
  iloscWynikowa: number;
  jednostkaWynikowa: string;
  skladniki: SkladnikProsty[];
  instrukcje: string[];
}

/**
 * Produkt sklepowy zaimportowany z Open Food Facts (scripts/import-off.mjs).
 * Trzymany osobno od `Ingredient`, bo to dane crowdsourcowane — używane wyłącznie
 * w kreatorze własnego posiłku, nigdy w kuratorowanych przepisach.
 */
export interface Produkt {
  kod: string;
  nazwa: string;
  marka?: string;
  makroNa100g: Makro;
  tagiAlergenow: string[];
  /** true = w OFF nikt nie uzupełnił alergenów, więc brak tagu NIE znaczy "bezpieczny". */
  alergenyNieznane: boolean;
  popularnosc: number;
}

/** Wspólny widok na składnik z bazy i produkt z OFF — tego używa kreator posiłku. */
export interface PozycjaSpizarni {
  /** Składnik bazowy ma zwykłe id ("kurczak-piers"), produkt z OFF prefiks: "off:5900...". */
  id: string;
  nazwa: string;
  marka?: string;
  makroNa100g: Makro;
  tagiAlergenow: string[];
  alergenyNieznane: boolean;
  masaSztuki?: number;
  zrodlo: "baza" | "off";
}

export const PREFIKS_PRODUKTU = "off:";

export type Charakter = "slodkie" | "wytrawne";
export type CzasPrzygotowania = "<15" | "15-30" | "30+";

/** Czy przepis jest daniem głównym, czy dodatkiem do niego. Brak pola = "glowne". */
export type KategoriaDania = "glowne" | "dodatek-skrobiowy" | "surowka";

export interface Recipe {
  id: string;
  nazwa: string;
  slot: string[];
  charakter: Charakter;
  porcje: number;
  czasPrzygotowania: CzasPrzygotowania;
  czasOczekiwania?: string;
  instrukcje: string[];
  skladniki: SkladnikPozycja[];
  kategoriaDania?: KategoriaDania;
  /** Kategorie dodatków, które silnik musi dobrać razem z tym daniem głównym (np. ryż + surówka). */
  wymaganeDodatki?: ("dodatek-skrobiowy" | "surowka")[];
}

export const SLOTY = ["sniadanie", "drugie-sniadanie", "obiad", "podwieczorek", "kolacja"] as const;
export type Slot = (typeof SLOTY)[number];
