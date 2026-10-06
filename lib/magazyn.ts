import type { WygenerowanyPlan } from "./engine/planner";
import type { Charakter, RodzajPotrawy, Sprzet } from "./engine/types";

/**
 * Warstwa zapisu danych usera.
 *
 * Dziś wszystko siedzi w `localStorage` — bez konta, bez hasła, bez bazy. Konsekwencja jest
 * uczciwa i trzeba ją znać: **dane są przypisane do przeglądarki**. Na telefonie będzie pusto,
 * a wyczyszczenie danych strony kasuje profil i plan.
 *
 * Cały dostęp idzie przez ten moduł właśnie po to, żeby dało się to później podmienić na zapis
 * serwerowy (kod dostępu typu „ZUPA-4827" + baza) bez przepisywania widoków. Reszta aplikacji
 * nie wie, gdzie te dane leżą — woła `magazyn.wczytajProfil()` i tyle.
 */

const KLUCZ = {
  profil: "dietetyq:profil",
  plan: "dietetyq:plan",
  postep: "dietetyq:postep",
  zakupy: "dietetyq:zakupy",
  waga: "dietetyq:waga",
} as const;

export interface DanePomiarowe {
  waga?: number;
  wzrost?: number;
  wiek?: number;
  plec?: "K" | "M";
  aktywnoscPraca?: 1 | 2 | 3 | 4;
  aktywnoscPozaPraca?: "A" | "B" | "C" | "D" | "E" | "F";
  cel?: "redukcja" | "utrzymanie" | "masa";
}

export interface Profil {
  nick: string;
  /** Kiedy powstał — do pokazania „jesteś z nami od...", ale też do migracji formatu. */
  utworzony: string;
  liczbaPosilkow: 3 | 4 | 5;
  /**
   * Czy dorzucać do dnia przekąskę (garść orzechów, jabłko z orzechami, serek wiejski).
   * Osobno od `liczbaPosilkow`, bo to nie jest kolejny posiłek do ugotowania — przekąska
   * dochodzi też przy trzech posiłkach i bierze swój kawałek dziennych kalorii, zamiast
   * doklejać się do nich ponad limit. Brak w zapisanym profilu = włączona.
   */
  przekaska?: boolean;
  liczbaOsob: number;
  /** Puste albo oba smaki = bez preferencji; jeden = premia dla dań tego smaku. */
  smakPerSlot: Record<string, Charakter[]>;
  kcalDzienne?: number;
  makro: { bialko: number; tluszcz: number; wegle: number };
  dane?: DanePomiarowe;
  restrykcje: string[];
  nielubianeSkladniki: string[];
  lubianeSkladniki: string[];
  bezSprzetu: Sprzet[];
  stylGotowania: "lubie-gotowac" | "normalnie" | "minimum-roboty";
  /** Rodzaje potraw, które user lubi — te dania wypadają w planie częściej. */
  ulubioneRodzaje: RodzajPotrawy[];
}

export interface PostepPlanu {
  /** Klucze zjedzonych posiłków w formacie „dzien:indeks". */
  zjedzone: string[];
}

export interface WpisWagi {
  data: string;
  waga: number;
}

function czytaj<T>(klucz: string): T | null {
  // localStorage rzuca wyjątkiem w trybie prywatnym i przy zablokowanych danych stron,
  // a przy pierwszym renderze na serwerze w ogóle nie istnieje.
  if (typeof window === "undefined") return null;
  try {
    const surowe = window.localStorage.getItem(klucz);
    return surowe ? (JSON.parse(surowe) as T) : null;
  } catch {
    return null;
  }
}

function zapisz(klucz: string, wartosc: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(klucz, JSON.stringify(wartosc));
  } catch {
    // Brak miejsca albo zablokowane dane stron — trudno, apka ma działać dalej.
  }
}

function usun(klucz: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(klucz);
  } catch {
    /* jak wyżej */
  }
}

export const magazyn = {
  wczytajProfil: () => czytaj<Profil>(KLUCZ.profil),
  zapiszProfil: (profil: Profil) => zapisz(KLUCZ.profil, profil),

  wczytajPlan: () => czytaj<WygenerowanyPlan>(KLUCZ.plan),
  zapiszPlan: (plan: WygenerowanyPlan) => zapisz(KLUCZ.plan, plan),
  usunPlan: () => {
    usun(KLUCZ.plan);
    usun(KLUCZ.postep);
    usun(KLUCZ.zakupy);
  },

  wczytajPostep: () => czytaj<PostepPlanu>(KLUCZ.postep) ?? { zjedzone: [] },
  zapiszPostep: (postep: PostepPlanu) => zapisz(KLUCZ.postep, postep),

  /** Id składników odhaczonych na liście zakupów („mam to w koszyku"). */
  wczytajZakupy: () => czytaj<string[]>(KLUCZ.zakupy) ?? [],
  zapiszZakupy: (kupione: string[]) => zapisz(KLUCZ.zakupy, kupione),

  wczytajWage: () => czytaj<WpisWagi[]>(KLUCZ.waga) ?? [],
  dopiszWage: (waga: number) => {
    const dzis = new Date().toISOString().slice(0, 10);
    const historia = (czytaj<WpisWagi[]>(KLUCZ.waga) ?? []).filter((w) => w.data !== dzis);
    const nowa = [...historia, { data: dzis, waga }].sort((a, b) => a.data.localeCompare(b.data));
    zapisz(KLUCZ.waga, nowa);
    return nowa;
  },
  /** Czy user podał już dziś wagę — żeby nie pytać go o to przy każdym odświeżeniu. */
  czyPytacOWage: () => {
    const historia = czytaj<WpisWagi[]>(KLUCZ.waga) ?? [];
    if (historia.length === 0) return false; // nie zna wagi = nie zawracamy głowy
    return historia[historia.length - 1].data !== new Date().toISOString().slice(0, 10);
  },

  wyczysc: () => Object.values(KLUCZ).forEach(usun),
};

export const PUSTY_PROFIL: Omit<Profil, "nick" | "utworzony"> = {
  liczbaPosilkow: 3,
  przekaska: true,
  liczbaOsob: 1,
  smakPerSlot: {},
  makro: { bialko: 30, tluszcz: 35, wegle: 35 },
  restrykcje: [],
  nielubianeSkladniki: [],
  lubianeSkladniki: [],
  bezSprzetu: [],
  stylGotowania: "normalnie",
  ulubioneRodzaje: [],
};

/** Sloty wynikające z liczby posiłków — ta sama tabela co w kroku 2 starego formularza. */
export const SLOTY_DLA_LICZBY: Record<number, string[]> = {
  3: ["sniadanie", "obiad", "kolacja"],
  4: ["sniadanie", "drugie-sniadanie", "obiad", "kolacja"],
  5: ["sniadanie", "drugie-sniadanie", "obiad", "podwieczorek", "kolacja"],
};

/**
 * Etykiety slotów. Trzymane tu, bo trzy widoki planu renderują te same sloty i do tej pory
 * każdy miał własną kopię tej mapy — dodanie przekąski znaczyło poprawienie jej w trzech
 * miejscach albo pokazanie userowi gołego „przekaska".
 *
 * Onboarding ma własną, krótszą listę i tak zostaje: pyta o smak KAŻDEGO posiłku, a przy
 * przekąsce nie ma czego pytać.
 */
export const NAZWY_SLOTOW: Record<string, string> = {
  sniadanie: "🌅 Śniadanie",
  "drugie-sniadanie": "🥪 II śniadanie",
  obiad: "🍽️ Obiad",
  podwieczorek: "🍓 Podwieczorek",
  kolacja: "🌙 Kolacja",
  przekaska: "🍏 Przekąska",
};

/**
 * Sloty dla profilu — posiłki plus ewentualna przekąska na końcu dnia.
 * Przekąska celowo idzie ostatnia: to ma być coś między posiłkami, a nie szósty posiłek
 * wciśnięty w środek planu.
 */
export function slotyProfilu(profil: Pick<Profil, "liczbaPosilkow" | "przekaska">): string[] {
  const sloty = SLOTY_DLA_LICZBY[profil.liczbaPosilkow];
  if (profil.przekaska === false) return sloty;

  /*
   * Przekąska wchodzi PO obiedzie, a nie na koniec dnia. Doklejona na szarym końcu wyglądała
   * jak coś do zjedzenia po kolacji, a to ma być ta rzecz, po którą sięga się po południu —
   * i tak ją czyta kolejność w planie dnia. Gdy obiadu nie ma w układzie, ląduje przed
   * ostatnim posiłkiem, czyli nadal nie na końcu.
   */
  const poObiedzie = sloty.indexOf("obiad");
  const miejsce = poObiedzie >= 0 ? poObiedzie + 1 : Math.max(0, sloty.length - 1);
  return [...sloty.slice(0, miejsce), "przekaska", ...sloty.slice(miejsce)];
}
