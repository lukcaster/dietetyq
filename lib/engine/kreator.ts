import { getComponentById, getIngredientById } from "./data";
import type { SkladnikBazowyWPlanie } from "./lista-zakupow";
import { dodajMakro, pustaMakro } from "./macro";
import type { KomponentWPlanie, PosilekWPlanie, SkladnikWPlanie } from "./planner";
import { granicePozycji, naJednostke, type JednostkaPorcji } from "./porcje";
import { dobierzIlosci, type Odchylenia, type PozycjaDoDobrania } from "./solver";
import { maZakazanyAlergen, pobierzPozycjeSpizarni } from "./spizarnia";
import { PREFIKS_KOMPONENTU, type Makro, type PozycjaSpizarni } from "./types";

/**
 * Kreator własnego posiłku — ścieżka dla kogoś, kto nie chce przepisu, tylko mówi
 * "dziś smażony kurczak": wybiera kurczaka, oliwę i warzywa, a silnik dobiera gramatury
 * pod cel kaloryczno-makrowy slotu.
 *
 * Wynik jest zwykłym `PosilekWPlanie`, więc wchodzi w plan w miejsce dowolnego posiłku
 * i liczy się do makro dnia oraz do listy zakupów tak samo jak posiłek z bazy przepisów.
 */

export type JednostkaKreatora = "g" | "ml" | "szt";

export interface PozycjaKreatora {
  /** Id ze spiżarni: składnik bazowy albo produkt z OFF ("off:..."). */
  id: string;
  ilosc: number;
  jednostka: JednostkaKreatora;
  /** Ilość zablokowana przez usera — solver jej nie rusza ("150 g piersi ma zostać 150 g"). */
  stala?: boolean;
  min?: number;
  max?: number;
}

export interface ZapytanieKreatora {
  slot: string;
  nazwa?: string;
  pozycje: PozycjaKreatora[];
  restrykcje?: string[];
  /** Cel makro posiłku — zwykle target slotu z planu. */
  cel?: Makro;
  /**
   * Własne kroki przygotowania. Nie zgadujemy ich za usera — to on wie, co chce z tym zrobić
   * — ale bez żadnych instrukcji posiłek własny w „Moim planie" był samą listą składników.
   */
  instrukcje?: string[];
  /** Gdy true i podano cel: solver dobiera gramatury pozycji nieoznaczonych jako stałe. */
  dopasuj?: boolean;
}

export interface WynikKreatora {
  posilek: PosilekWPlanie;
  cel?: Makro;
  odchylenia?: Odchylenia;
  ostrzezenia: string[];
}

/** Powyżej tego rozjazdu (w %) mówimy wprost, że celu nie da się trafić tym zestawem. */
const PROG_OSTRZEZENIA_PROCENT = 10;

const KROK_JEDNOSTKI: Record<JednostkaKreatora, number> = { g: 5, ml: 5, szt: 1 };

/**
 * Sufity z porcje.ts znają tylko gramy i sztuki. Mililitry traktujemy jak gramy — tak samo
 * robi reszta silnika (mleko 250 ml liczymy z makroNa100g), a wszystkie płyny w bazie mają
 * gęstość na tyle bliską jedynce, że rozróżnianie tego byłoby udawaną precyzją.
 */
function jakPorcja(jednostka: JednostkaKreatora): JednostkaPorcji {
  return jednostka === "szt" ? "szt" : "g";
}

function nazwaWyswietlana(pozycja: PozycjaSpizarni): string {
  return pozycja.marka ? `${pozycja.nazwa} (${pozycja.marka})` : pozycja.nazwa;
}

/**
 * Makro jednej jednostki. `ml` traktujemy jak gramy — tak samo jak reszta silnika
 * (patrz masaWGramach w macro.ts); dla mleka czy oleju błąd z gęstości jest pomijalny
 * wobec rozrzutu samych tabel wartości odżywczych.
 */
export function makroNaJednostke(pozycja: PozycjaSpizarni, jednostka: JednostkaKreatora): Makro {
  const gramyNaJednostke = jednostka === "szt" ? (pozycja.masaSztuki ?? 0) : 1;
  const wspolczynnik = gramyNaJednostke / 100;
  return {
    kcal: pozycja.makroNa100g.kcal * wspolczynnik,
    bialko: pozycja.makroNa100g.bialko * wspolczynnik,
    tluszcz: pozycja.makroNa100g.tluszcz * wspolczynnik,
    wegle: pozycja.makroNa100g.wegle * wspolczynnik,
  };
}

function zaokraglijIlosc(ilosc: number, jednostka: JednostkaKreatora): number {
  return jednostka === "szt" ? Math.round(ilosc) : Math.round(ilosc * 10) / 10;
}

export function zbudujPosilekWlasny(zapytanie: ZapytanieKreatora): WynikKreatora {
  const restrykcje = zapytanie.restrykcje ?? [];
  if (zapytanie.pozycje.length === 0) throw new Error("Posiłek musi mieć co najmniej jeden składnik");

  const ostrzezenia: string[] = [];
  const rozwiazane = zapytanie.pozycje.map((pozycja) => {
    const zeSpizarni = pobierzPozycjeSpizarni(pozycja.id);
    if (pozycja.ilosc < 0) throw new Error(`Ujemna ilość dla "${zeSpizarni.nazwa}"`);
    if (pozycja.jednostka === "szt" && !zeSpizarni.masaSztuki) {
      throw new Error(`"${zeSpizarni.nazwa}" nie ma zdefiniowanej masy sztuki — podaj ilość w gramach`);
    }

    if (maZakazanyAlergen(zeSpizarni, restrykcje)) {
      const zakazane = zeSpizarni.tagiAlergenow.filter((t) => restrykcje.includes(t));
      ostrzezenia.push(`${nazwaWyswietlana(zeSpizarni)} zawiera: ${zakazane.join(", ")} — masz to na liście restrykcji.`);
    } else if (zeSpizarni.alergenyNieznane && restrykcje.length > 0) {
      ostrzezenia.push(
        `${nazwaWyswietlana(zeSpizarni)}: alergeny nieuzupełnione w Open Food Facts — sprawdź opakowanie.`
      );
    }

    return { wejscie: pozycja, zeSpizarni };
  });

  let ilosci = rozwiazane.map((r) => r.wejscie.ilosc);
  let odchylenia: Odchylenia | undefined;

  if (zapytanie.dopasuj && zapytanie.cel) {
    const cel = zapytanie.cel;
    const doDobrania: PozycjaDoDobrania[] = rozwiazane.map(({ wejscie, zeSpizarni }) => {
      /*
       * Te same sufity kulinarne, co w planie i w trybie z lodówki (porcje.ts). Wcześniej
       * kreator miał własny limit „cztery razy tyle, ile wpisałeś" i przy domyślnych 100 g
       * pozwalał solverowi dojechać do 400 g — stąd 355 g rzodkiewki w jednym posiłku,
       * mimo że rzodkiewka ma w bazie maksPorcja 120.
       */
      const granice = granicePozycji({
        rola: zeSpizarni.rolaKulinarna,
        jednostka: jakPorcja(wejscie.jednostka),
        celSlotu: cel,
        wRdzeniu: false,
        sufitSkladnika: naJednostke(zeSpizarni.maksPorcja, jakPorcja(wejscie.jednostka), zeSpizarni.masaSztuki),
        porcjaTypowa: naJednostke(zeSpizarni.porcjaTypowa, jakPorcja(wejscie.jednostka), zeSpizarni.masaSztuki),
      });

      return {
        id: wejscie.id,
        makroNaJednostke: makroNaJednostke(zeSpizarni, wejscie.jednostka),
        ilosc: wejscie.ilosc,
        stala: wejscie.stala,
        min: wejscie.min ?? 0,
        // Ilość wpisana ręcznie zawsze mieści się w granicach: sufity mają powstrzymać solvera
        // przed absurdem, a nie kłócić się z userem, który świadomie wpisał 300 g czegoś.
        max: wejscie.max ?? Math.max(granice.max, wejscie.ilosc),
        krok: KROK_JEDNOSTKI[wejscie.jednostka],
        preferowana: granice.preferowana,
      };
    });

    const wynik = dobierzIlosci(doDobrania, zapytanie.cel);
    ilosci = wynik.pozycje.map((p) => p.ilosc);
    odchylenia = wynik.odchylenia;

    if (wynik.najwiekszeOdchylenie > PROG_OSTRZEZENIA_PROCENT) {
      ostrzezenia.push(
        `Tym zestawem nie da się trafić w cel — największy rozjazd to ${Math.round(wynik.najwiekszeOdchylenie)}%. ` +
          `Dodaj składnik, który nadrobi brakujące makro, albo poluzuj limity ilości.`
      );
    }

    for (let i = 0; i < wynik.pozycje.length; i++) {
      const pozycja = wynik.pozycje[i];
      if (!pozycja.przyLimicie) continue;
      const nazwa = nazwaWyswietlana(rozwiazane[i].zeSpizarni);
      const granica = pozycja.przyLimicie === "max" ? "górny" : "dolny";
      ostrzezenia.push(`${nazwa}: solver oparł się o ${granica} limit ilości (${pozycja.ilosc}).`);
    }
  }

  const skladniki: SkladnikWPlanie[] = [];
  const skladnikiBazowe: SkladnikBazowyWPlanie[] = [];
  const komponenty: KomponentWPlanie[] = [];
  let makro = pustaMakro();

  for (let i = 0; i < rozwiazane.length; i++) {
    const { wejscie, zeSpizarni } = rozwiazane[i];
    const ilosc = zaokraglijIlosc(ilosci[i], wejscie.jednostka);
    const makroJednostki = makroNaJednostke(zeSpizarni, wejscie.jednostka);
    makro = dodajMakro(makro, {
      kcal: makroJednostki.kcal * ilosc,
      bialko: makroJednostki.bialko * ilosc,
      tluszcz: makroJednostki.tluszcz * ilosc,
      wegle: makroJednostki.wegle * ilosc,
    });

    const wpis = { skladnikId: wejscie.id, nazwa: nazwaWyswietlana(zeSpizarni), ilosc, jednostka: wejscie.jednostka };
    skladniki.push(wpis);

    // Komponent (ciasto) rozbijamy na surowce, tak jak robi to planer: na liście zakupów
    // kupuje się mąkę i jajka, a nie „ciasto pierogowe", a bilans mikro bez tego gubiłby
    // cały półprodukt.
    if (wejscie.id.startsWith(PREFIKS_KOMPONENTU)) {
      const komponent = getComponentById(wejscie.id.slice(PREFIKS_KOMPONENTU.length));
      // Ciasto liczone w sztukach („3 naleśniki") trzeba najpierw przeliczyć z powrotem
      // na gramy — proporcja składu odnosi się do wydajności komponentu, a ta jest w gramach.
      const gramy = wejscie.jednostka === "szt" ? ilosc * (zeSpizarni.masaSztuki ?? 0) : ilosc;
      const proporcja = komponent.iloscWynikowa > 0 ? gramy / komponent.iloscWynikowa : 0;

      const skladnikiKomponentu = komponent.skladniki.map((surowiec) => ({
        skladnikId: surowiec.skladnikId,
        nazwa: getIngredientById(surowiec.skladnikId).nazwa,
        ilosc: Math.round(surowiec.ilosc * proporcja * 10) / 10,
        jednostka: surowiec.jednostka,
      }));
      skladnikiBazowe.push(...skladnikiKomponentu);

      // Bez tego posiłek z kreatora nie miał ANI JEDNEJ instrukcji: user widział „Ciasto
      // naleśnikowe — 220 g" i nie miał gdzie sprawdzić, jak to ciasto zrobić.
      komponenty.push({
        komponentId: komponent.id,
        nazwa: komponent.nazwa,
        skladniki: skladnikiKomponentu,
        instrukcje: komponent.instrukcje,
      });
    } else {
      skladnikiBazowe.push({ ...wpis });
    }
  }

  const posilek: PosilekWPlanie = {
    slot: zapytanie.slot,
    recipeId: "wlasny",
    nazwa: zapytanie.nazwa?.trim() || "Posiłek własny",
    skladniki,
    skladnikiBazowe,
    instrukcje: zapytanie.instrukcje?.map((k) => k.trim()).filter(Boolean) ?? [],
    makro,
    wlasny: true,
    komponenty: komponenty.length > 0 ? komponenty : undefined,
  };

  return { posilek, cel: zapytanie.cel, odchylenia, ostrzezenia };
}
