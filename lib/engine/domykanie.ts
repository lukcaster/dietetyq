import { getIngredientById } from "./data";
import { dodajMakro, skalujMakro, skladnikOdrzucony, type FiltrSkladnikow } from "./macro";
import type { Makro } from "./types";

/**
 * Domykanie dnia — „dorzuć plaster sera", a nie „sypnij odżywkę".
 *
 * Silnik trafia w kalorie, ale białko potrafi się rozjechać między dniami (raz 117 g, raz 184 g
 * przy celu 165). Kuszące byłoby dokręcić to solverem albo dosypywać odżywkę białkową do skutku
 * — i to jest dokładnie ta apka, której tu NIE robimy. Ta ma pomagać jeść zdrowiej, a nie
 * pilnować makro jak przed zawodami.
 *
 * Dlatego domykanie jest celowo **słabe i jawne**:
 * - rusza tylko wtedy, gdy brakuje naprawdę sporo białka (nie 5 g),
 * - dokłada **zwykłe jedzenie** w porcjach, którymi mówi się w kuchni („2 plastry szynki"),
 *   a nie gramaturę z solvera,
 * - nigdy nie sięga po odżywki białkowe, nawet gdyby były najskuteczniejsze,
 * - ma twardy sufit dołożonych kalorii, więc nie zamieni obiadu w drugi obiad,
 * - nie musi domknąć do zera. Dzień z białkiem na 90% normy jest w porządku.
 *
 * Nic nie odejmujemy: gdy białka jest za dużo, to nie jest problem, który warto userowi
 * zgłaszać, a już na pewno nie taki, żeby zabierać mu jedzenie z talerza.
 */

export interface Dosypka {
  skladnikId: string;
  nazwa: string;
  ilosc: number;
  jednostka: string;
  makro: Makro;
  /** Tekst dla usera: „2 plastry szynki (50 g)". */
  opis: string;
}

/** Poniżej tego niedoboru nic nie robimy — to już jest „w porządku", nie problem. */
const PROG_NIEDOBORU_G = 15;

/** Ile najwyżej dosypek na dzień. Trzy plastry sera to dosypka, dziesięć to inny plan dnia. */
const MAKS_DOSYPEK = 3;

/** O ile najwyżej wolno przekroczyć dzienne kcal, domykając białko. */
const ZAPAS_KCAL = 1.05;

/**
 * Losujemy spośród dosypek dających przynajmniej tyle białka, co najlepsza z nich razy ta wartość.
 *
 * Bez losowania wygrywał zawsze ten sam składnik (skyr ma najlepszy stosunek białka do kalorii),
 * więc user dostawał „mały skyr" przy każdym posiłku przez siedem dni — czyli dokładnie to
 * uczucie „apka każe mi jeść białko", którego ma tu nie być. Plaster szynki zamiast skyru kosztuje
 * kilka gramów białka i jest tego wart.
 */
const PROG_LOSOWANIA = 0.6;

type PoraDnia = "lekka" | "obiadowa";

interface Kandydat {
  skladnikId: string;
  /** Porcja, którą normalnie się dokłada — plaster, jajko, łyżka. */
  porcja: number;
  jednostka: "g" | "szt";
  /** Jak o tej porcji mówi człowiek: („2 plastry szynki"). Liczba mnoga dobrana ręcznie. */
  nazwij: (ile: number) => string;
  /** Do jakich posiłków pasuje. */
  pory: PoraDnia[];
  /** Czy pasuje do posiłku na słodko (owsianka, naleśniki, miska białkowa). */
  doSlodkiego: boolean;
}

/**
 * Lista jest krótka i ręczna, bo to jedyny sposób, żeby dosypki brzmiały jak jedzenie,
 * a nie jak wynik optymalizacji. Świadomie NIE ma tu odżywek białkowych ani izolatów —
 * patrz nagłówek modułu.
 */
const KANDYDACI: Kandydat[] = [
  {
    skladnikId: "szynka",
    porcja: 25,
    jednostka: "g",
    nazwij: (ile) => (ile === 1 ? "plaster szynki" : `${ile} plastry szynki`),
    pory: ["lekka"],
    doSlodkiego: false,
  },
  {
    skladnikId: "ser-zolty",
    porcja: 20,
    jednostka: "g",
    nazwij: (ile) => (ile === 1 ? "plaster sera żółtego" : `${ile} plastry sera żółtego`),
    pory: ["lekka"],
    doSlodkiego: false,
  },
  {
    skladnikId: "jajko",
    porcja: 1,
    jednostka: "szt",
    nazwij: (ile) => (ile === 1 ? "jajko na twardo" : `${ile} jajka na twardo`),
    pory: ["lekka", "obiadowa"],
    doSlodkiego: false,
  },
  {
    skladnikId: "twarog-polnotlusty",
    porcja: 50,
    jednostka: "g",
    nazwij: (ile) => `${ile === 1 ? "łyżka" : `${ile} łyżki`} twarogu`,
    pory: ["lekka"],
    doSlodkiego: true,
  },
  {
    skladnikId: "skyr-naturalny",
    porcja: 100,
    jednostka: "g",
    nazwij: (ile) => (ile === 1 ? "mały skyr" : `${ile} kubki skyru`),
    pory: ["lekka"],
    doSlodkiego: true,
  },
  {
    skladnikId: "serek-wiejski",
    porcja: 100,
    jednostka: "g",
    nazwij: (ile) => (ile === 1 ? "opakowanie serka wiejskiego" : `${ile} opakowania serka wiejskiego`),
    pory: ["lekka"],
    doSlodkiego: false,
  },
  {
    skladnikId: "kurczak-piers",
    porcja: 50,
    jednostka: "g",
    nazwij: (ile) => `${ile * 50} g piersi z kurczaka więcej`,
    pory: ["obiadowa"],
    doSlodkiego: false,
  },
];

const PORY_SLOTOW: Record<string, PoraDnia> = {
  sniadanie: "lekka",
  "drugie-sniadanie": "lekka",
  podwieczorek: "lekka",
  obiad: "obiadowa",
  kolacja: "obiadowa",
};

export interface PosilekDoDomkniecia {
  slot: string;
  /** Brak dla gotowców — wtedy o „słodkości" decydują składniki. */
  charakter?: "slodkie" | "wytrawne";
  skladnikiId: string[];
  makro: Makro;
}

/**
 * Czy ten posiłek jest na słodko. Dla przepisu wystarczy `charakter`; gotowiec go nie ma,
 * więc patrzymy na składniki — owoc i dodatek słodki bez mięsa i wędliny to deser, nie obiad.
 */
function naSlodko(posilek: PosilekDoDomkniecia): boolean {
  if (posilek.charakter) return posilek.charakter === "slodkie";
  const role = posilek.skladnikiId.map((id) => {
    try {
      return getIngredientById(id).rolaKulinarna;
    } catch {
      return undefined;
    }
  });
  const slodkie = role.some((r) => r === "owoc" || r === "dodatek-slodki");
  const wytrawne = role.some((r) => r === "mieso" || r === "wedlina" || r === "sos" || r === "warzywo");
  return slodkie && !wytrawne;
}

export interface WynikDomkniecia {
  /** Indeks posiłku w dniu → dosypki dołożone do tego posiłku. */
  dosypki: Map<number, Dosypka[]>;
  /** Ile białka udało się dołożyć (g) — do ewentualnego komunikatu. */
  dodaneBialko: number;
}

/**
 * Próbuje domknąć niedobór białka w dniu, dokładając zwykłe jedzenie do istniejących posiłków.
 * Zwraca puste dosypki, gdy nie ma czego domykać albo nie da się tego zrobić sensownie.
 */
export function domknijBialko(
  posilki: PosilekDoDomkniecia[],
  makroDnia: Makro,
  celDnia: Makro,
  filtr: FiltrSkladnikow
): WynikDomkniecia {
  const dosypki = new Map<number, Dosypka[]>();
  let brakujeBialka = celDnia.bialko - makroDnia.bialko;
  let kcalDnia = makroDnia.kcal;
  let dodaneBialko = 0;

  if (brakujeBialka < PROG_NIEDOBORU_G || posilki.length === 0) return { dosypki, dodaneBialko };

  const sufitKcal = celDnia.kcal * ZAPAS_KCAL;

  // Sprawdzamy kandydatów od najbardziej „białkowych na kaloriię", żeby domknięcie kosztowało
  // jak najmniej kalorii — ale bez sortowania po samym białku, bo wtedy zawsze wygrywałaby
  // jedna pozycja i user dostawałby siedem dni z tym samym plastrem sera.
  const dostepni = KANDYDACI.filter((k) => {
    try {
      return !skladnikOdrzucony(getIngredientById(k.skladnikId), filtr);
    } catch {
      return false;
    }
  });
  if (dostepni.length === 0) return { dosypki, dodaneBialko };

  /** Składniki już dziś dołożone — dwa razy ten sam plaster sera to nie jest urozmaicenie. */
  const juzDolozone = new Set<string>();

  for (let proba = 0; proba < MAKS_DOSYPEK && brakujeBialka >= PROG_NIEDOBORU_G; proba++) {
    const mozliwe: { indeks: number; kandydat: Kandydat; makro: Makro }[] = [];

    for (let i = 0; i < posilki.length; i++) {
      const posilek = posilki[i];
      const pora = PORY_SLOTOW[posilek.slot] ?? "lekka";
      const slodki = naSlodko(posilek);
      // Jeden posiłek dostaje najwyżej jedną dosypkę — „do śniadania dorzuć ser, szynkę i jajko"
      // to już nie jest dosypka, tylko drugie śniadanie.
      if (dosypki.has(i)) continue;

      for (const kandydat of dostepni) {
        if (!kandydat.pory.includes(pora)) continue;
        if (slodki && !kandydat.doSlodkiego) continue;
        if (juzDolozone.has(kandydat.skladnikId)) continue;
        // „Więcej piersi" ma sens tylko wtedy, gdy w daniu jakieś mięso już jest.
        if (kandydat.skladnikId === "kurczak-piers" && !posilek.skladnikiId.includes("kurczak-piers")) continue;
        if (posilek.skladnikiId.includes(kandydat.skladnikId) && kandydat.skladnikId !== "kurczak-piers") continue;

        const skladnik = getIngredientById(kandydat.skladnikId);
        const gramy = kandydat.jednostka === "szt" ? (skladnik.masaSztuki ?? 0) * kandydat.porcja : kandydat.porcja;
        const makro = skalujMakro(skladnik.makroNa100g, gramy / 100);
        if (kcalDnia + makro.kcal > sufitKcal) continue;

        mozliwe.push({ indeks: i, kandydat, makro });
      }
    }

    if (mozliwe.length === 0) break;

    const najwiecejBialka = Math.max(...mozliwe.map((m) => m.makro.bialko));
    const sensowne = mozliwe.filter((m) => m.makro.bialko >= najwiecejBialka * PROG_LOSOWANIA);
    const { indeks, kandydat, makro } = sensowne[Math.floor(Math.random() * sensowne.length)];
    juzDolozone.add(kandydat.skladnikId);
    const skladnik = getIngredientById(kandydat.skladnikId);
    dosypki.set(indeks, [
      {
        skladnikId: kandydat.skladnikId,
        nazwa: skladnik.nazwa,
        ilosc: kandydat.porcja,
        jednostka: kandydat.jednostka,
        makro,
        opis: `${kandydat.nazwij(1)} (${kandydat.jednostka === "szt" ? `${kandydat.porcja} szt` : `${kandydat.porcja} g`})`,
      },
    ]);
    brakujeBialka -= makro.bialko;
    dodaneBialko += makro.bialko;
    kcalDnia += makro.kcal;
  }

  return { dosypki, dodaneBialko };
}

export function makroDosypek(dosypki: Dosypka[]): Makro {
  return dosypki.reduce((suma, d) => dodajMakro(suma, d.makro), { kcal: 0, bialko: 0, tluszcz: 0, wegle: 0 });
}
