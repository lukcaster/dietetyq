import { getIngredientById } from "./data";
import { dodajMakro, pustaMakro, skalujMakro, skladnikOdrzucony, type FiltrSkladnikow } from "./macro";
import { KROK_JEDNOSTKI } from "./porcje";
import { dobierzIlosci, type PozycjaDoDobrania } from "./solver";
import type { Makro } from "./types";

/**
 * Przekąska — to, co człowiek je między posiłkami, bo ma ochotę, a nie dlatego, że musi
 * wyrobić normę.
 *
 * Powstało zamiast rozbudowywania domykania białka. Domykanie dokłada plaster szynki DO
 * posiłku, żeby dobić makro — przydatne, ale siedem dni pod rząd z doklejonym jajkiem brzmi
 * jak apka licząca za kogoś gramy. Garść orzechów o 16:00 to normalne jedzenie, nie korekta
 * tabelki, i dlatego przekąska jest osobnym posiłkiem z własnym budżetem kalorii (patrz
 * WAGI_SLOTOW w cele.ts), a nie dopiskiem do obiadu.
 *
 * Lista jest krótka i ręczna z tego samego powodu co lista dosypek: zestaw ma brzmieć jak
 * coś, co ktoś naprawdę zjada, a nie jak wynik optymalizacji. Dlatego są tu pary, które same
 * z siebie mają sens kulinarny (jabłko z orzechami, marchewki z hummusem), a nie pojedyncze
 * składniki dobrane pod makro.
 */

export const SLOT_PRZEKASKI = "przekaska";

interface SkladnikPrzekaski {
  skladnikId: string;
  /** Porcja, od której startuje solver. Skaluje się potem do celu kalorycznego przekąski. */
  ilosc: number;
  jednostka: "g" | "szt";
  /**
   * Składnik, bez którego przekąska przestaje być sobą — jabłko z orzechami bez jabłka
   * to garść orzechów. Solver nie może zejść z nim poniżej sensownej porcji.
   */
  rdzen?: boolean;
}

interface Przekaska {
  id: string;
  nazwa: string;
  skladniki: SkladnikPrzekaski[];
  instrukcje: string[];
}

const PRZEKASKI: Przekaska[] = [
  {
    id: "garsc-orzechow",
    nazwa: "Garść orzechów",
    skladniki: [{ skladnikId: "mieszanka-orzechow", ilosc: 30, jednostka: "g", rdzen: true }],
    instrukcje: ["Odsyp porcję do miseczki zamiast jeść prosto z opakowania — inaczej garść robi się połową torebki."],
  },
  {
    id: "jablko-z-orzechami",
    nazwa: "Jabłko z orzechami włoskimi",
    skladniki: [
      { skladnikId: "jablko", ilosc: 150, jednostka: "g", rdzen: true },
      { skladnikId: "orzechy-wloskie", ilosc: 20, jednostka: "g", rdzen: true },
    ],
    instrukcje: ["Jabłko pokrój w ósemki, orzechy połam w dłoni."],
  },
  {
    id: "serek-wiejski-z-pomidorkami",
    nazwa: "Serek wiejski z pomidorkami",
    skladniki: [
      { skladnikId: "serek-wiejski", ilosc: 150, jednostka: "g", rdzen: true },
      { skladnikId: "pomidorki-koktajlowe", ilosc: 80, jednostka: "g" },
      { skladnikId: "szczypiorek", ilosc: 5, jednostka: "g" },
    ],
    instrukcje: ["Pomidorki przekrój na pół, wymieszaj z serkiem, posyp szczypiorkiem i popieprz."],
  },
  {
    id: "jogurt-z-borowkami",
    nazwa: "Jogurt z borówkami",
    skladniki: [
      { skladnikId: "jogurt-naturalny", ilosc: 150, jednostka: "g", rdzen: true },
      { skladnikId: "borowki", ilosc: 80, jednostka: "g", rdzen: true },
    ],
    instrukcje: ["Borówki wsyp na jogurt. Jeśli chcesz coś chrupiącego, dorzuć łyżkę płatków."],
  },
  {
    id: "banan-z-maslem-orzechowym",
    nazwa: "Banan z masłem orzechowym",
    skladniki: [
      { skladnikId: "banan", ilosc: 120, jednostka: "g", rdzen: true },
      { skladnikId: "maslo-orzechowe", ilosc: 20, jednostka: "g", rdzen: true },
    ],
    instrukcje: ["Banana przekrój wzdłuż i posmaruj masłem orzechowym."],
  },
  {
    id: "marchewki-z-hummusem",
    nazwa: "Marchewki z hummusem",
    skladniki: [
      { skladnikId: "marchew", ilosc: 120, jednostka: "g", rdzen: true },
      { skladnikId: "hummus", ilosc: 60, jednostka: "g", rdzen: true },
    ],
    instrukcje: ["Marchew pokrój w słupki. Hummus nałóż do osobnej miseczki, żeby maczać."],
  },
  {
    id: "daktyle-z-orzechami",
    nazwa: "Daktyle z orzechami (domowy batonik)",
    skladniki: [
      { skladnikId: "daktyle", ilosc: 40, jednostka: "g", rdzen: true },
      { skladnikId: "orzechy-nerkowca", ilosc: 20, jednostka: "g", rdzen: true },
      { skladnikId: "kakao", ilosc: 3, jednostka: "g" },
    ],
    instrukcje: [
      "Daktyle (bez pestek) zblenduj z orzechami i kakao na gęstą masę.",
      "Uformuj dwa batoniki i wstaw na 20 minut do lodówki, żeby stwardniały.",
      "Robi się to raz na kilka dni z większej porcji — z pojedynczej garści blender nie da rady.",
    ],
  },
  {
    id: "skyr-z-miodem-i-migdalami",
    nazwa: "Skyr z miodem i migdałami",
    skladniki: [
      { skladnikId: "skyr-naturalny", ilosc: 150, jednostka: "g", rdzen: true },
      { skladnikId: "miod", ilosc: 10, jednostka: "g" },
      { skladnikId: "migdaly", ilosc: 15, jednostka: "g" },
    ],
    instrukcje: ["Migdały posiekaj, wymieszaj ze skyrem i polej miodem."],
  },
  {
    id: "kanapka-z-szynka",
    nazwa: "Kanapka z szynką i ogórkiem",
    skladniki: [
      { skladnikId: "chleb-zytni-razowy", ilosc: 50, jednostka: "g", rdzen: true },
      { skladnikId: "szynka", ilosc: 40, jednostka: "g", rdzen: true },
      { skladnikId: "ogorek", ilosc: 40, jednostka: "g" },
    ],
    instrukcje: ["Chleb, szynka, plastry ogórka. Tyle."],
  },
  {
    id: "twarozek-z-rzodkiewka",
    nazwa: "Twarożek z rzodkiewką",
    skladniki: [
      { skladnikId: "twarog-polnotlusty", ilosc: 120, jednostka: "g", rdzen: true },
      { skladnikId: "rzodkiewka", ilosc: 60, jednostka: "g" },
      { skladnikId: "szczypiorek", ilosc: 5, jednostka: "g" },
    ],
    instrukcje: ["Twaróg rozgnieć widelcem, wmieszaj pokrojoną rzodkiewkę i szczypiorek, dopraw solą."],
  },
];

export interface SkladnikPrzekaskiWPlanie {
  skladnikId: string;
  nazwa: string;
  ilosc: number;
  jednostka: string;
  zamiast?: string;
}

export interface ZlozonaPrzekaska {
  przekaskaId: string;
  nazwa: string;
  skladniki: SkladnikPrzekaskiWPlanie[];
  makro: Makro;
  instrukcje: string[];
}

/** Poniżej tylu gramów składnik jest okruchem — solver nie może zejść niżej z rdzeniem. */
const MIN_RDZENIA_G = 15;

/**
 * Przekąski nie podmieniamy składników z kategorii (jak w przepisach): to zestaw dwóch-trzech
 * rzeczy i podmiana jednej robi z niego coś innego. Zamiast kombinować, odrzucamy całą
 * przekąskę i bierzemy następną — jest ich dziesięć, więc zawsze coś zostaje.
 */
function wykonalna(przekaska: Przekaska, filtr: FiltrSkladnikow): boolean {
  return przekaska.skladniki.every((s) => {
    try {
      return !skladnikOdrzucony(getIngredientById(s.skladnikId), filtr);
    } catch {
      return false;
    }
  });
}

export interface ZapytanieOPrzekaske {
  cel: Makro;
  filtr: FiltrSkladnikow;
  /** Przekąski użyte już w tym planie — żeby tydzień nie był siedmioma garściami orzechów. */
  wyklucz?: Set<string>;
}

/**
 * Składa jedną przekąskę pod zadany cel kaloryczny. Zwraca null, gdy przy tych restrykcjach
 * nie da się złożyć żadnej.
 */
export function zlozPrzekaske(zapytanie: ZapytanieOPrzekaske): ZlozonaPrzekaska | null {
  const { cel, filtr, wyklucz = new Set() } = zapytanie;

  const dostepne = PRZEKASKI.filter((p) => wykonalna(p, filtr));
  if (dostepne.length === 0) return null;

  // Najpierw te jeszcze nieużyte; gdy wszystkie już były, losujemy z całej puli.
  const swieze = dostepne.filter((p) => !wyklucz.has(p.id));
  const pula = swieze.length > 0 ? swieze : dostepne;
  const przekaska = pula[Math.floor(Math.random() * pula.length)];

  const pozycje: PozycjaDoDobrania[] = przekaska.skladniki.map((s) => {
    const skladnik = getIngredientById(s.skladnikId);
    const gramyNaJednostke = s.jednostka === "szt" ? (skladnik.masaSztuki ?? 0) : 1;
    const minimum = s.rdzen ? (s.jednostka === "szt" ? 1 : MIN_RDZENIA_G) : 0;
    return {
      id: s.skladnikId,
      makroNaJednostke: skalujMakro(skladnik.makroNa100g, gramyNaJednostke / 100),
      ilosc: s.ilosc,
      min: minimum,
      // Przekąska ma zostać przekąską: sufit to dwie porcje startowe, więc nawet przy dużym
      // celu kalorycznym nie zrobi się z garści orzechów pół paczki.
      max: s.ilosc * 2,
      krok: KROK_JEDNOSTKI[s.jednostka],
      preferowana: s.ilosc,
    };
  });

  const wynik = dobierzIlosci(pozycje, cel);

  const skladniki: SkladnikPrzekaskiWPlanie[] = [];
  let makro = pustaMakro();
  for (let i = 0; i < przekaska.skladniki.length; i++) {
    const wejscie = przekaska.skladniki[i];
    const skladnik = getIngredientById(wejscie.skladnikId);
    const ilosc =
      wejscie.jednostka === "szt" ? Math.max(1, Math.round(wynik.pozycje[i].ilosc)) : Math.round(wynik.pozycje[i].ilosc);
    const gramy = wejscie.jednostka === "szt" ? ilosc * (skladnik.masaSztuki ?? 0) : ilosc;
    makro = dodajMakro(makro, skalujMakro(skladnik.makroNa100g, gramy / 100));
    skladniki.push({ skladnikId: wejscie.skladnikId, nazwa: skladnik.nazwa, ilosc, jednostka: wejscie.jednostka });
  }

  return {
    przekaskaId: przekaska.id,
    nazwa: przekaska.nazwa,
    skladniki,
    makro,
    instrukcje: przekaska.instrukcje,
  };
}
