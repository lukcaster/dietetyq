import { getIngredients, getSzablony } from "./data";
import { dodajMakro, pustaMakro, skalujMakro, skladnikOdrzucony, type FiltrSkladnikow } from "./macro";
import { granicePozycji, naJednostke, MIN_SENSOWNA_PORCJA_G, type JednostkaPorcji } from "./porcje";
import { dobierzIlosci, type PozycjaDoDobrania } from "./solver";
import type { Ingredient, Makro, Sprzet, SzablonDania } from "./types";

/**
 * „Gotowiec" — posiłek złożony z szablonu (`data/szablony.json`) i zwykłych składników z bazy,
 * bez przepisu: kanapka, miska białkowa, koktajl, sałatka.
 *
 * Powstał z dwóch zgłoszeń naraz. Po pierwsze **plan tygodniowy się powtarzał**: przy wybranym
 * charakterze posiłku pula potrafiła zejść do jednego przepisu (wytrawne drugie śniadanie =
 * 1 przepis w bazie), więc user dostawał go siedem razy. Po drugie **nie wszystko musi być
 * gotowane** — na drugie śniadanie normalny człowiek robi kanapkę, a nie piecze keksówkę.
 *
 * Mechanizm jest ten sam, co fallback w trybie „z lodówki", ale bez ograniczenia koszykiem:
 * wybieramy do gniazd dowolne dopuszczalne składniki z bazy i dobieramy gramatury solverem.
 * Dzięki temu pula lekkich posiłków jest praktycznie nieskończona, a nie ograniczona liczbą
 * przepisów w JSON-ie.
 */

export interface SkladnikGotowca {
  skladnikId: string;
  nazwa: string;
  ilosc: number;
  jednostka: JednostkaPorcji;
}

export interface Gotowiec {
  szablonId: string;
  nazwa: string;
  skladniki: SkladnikGotowca[];
  makro: Makro;
  instrukcje: string[];
  /** Czy danie faktycznie nie wymaga gotowania — UI oznacza tym znacznik „bez gotowania". */
  naZimno: boolean;
  /** Rozjazd od celu slotu w % — planer używa go do wyboru między gotowcem a przepisem. */
  najwiekszeOdchylenie: number;
}

/**
 * Z jakim prawdopodobieństwem wypełniamy gniazdo **opcjonalne**. Gdyby zawsze, każda kanapka
 * miałaby komplet: dwa wierzchy, dwa warzywa i sos — poprawne, ale siedem dni z rzędu wygląda
 * jak jeden posiłek. Losowość jest tu po to, żeby dni się od siebie różniły.
 */
const SZANSA_NA_DODATEK = 0.55;

/** Ile razy próbujemy złożyć posiłek z tego samego szablonu, zanim uznamy go za nieudany. */
const PROBY_NA_SZABLON = 3;

/**
 * Ile gotowych propozycji zbieramy, zanim wybierzemy najlepszą.
 *
 * Wcześniej wygrywała pierwsza, która się złożyła — a skoro składniki do gniazd lecą losowo,
 * to trafienie w makro było kwestią szczęścia i dni z gotowcami schodziły do 100 g białka
 * przy celu 165. Kilka podejść i wybór najbliższego celowi kosztuje ułamek milisekundy,
 * a różnorodność zostaje, bo szablony i składniki dalej losujemy.
 */
const ILE_PROPOZYCJI = 8;

/**
 * Składniki, które są półproduktem albo mają sens tylko w przepisie — do gotowca nie wchodzą,
 * choć rolę kulinarną mają. Dotyczy przypraw (sama rola „przyprawa" nie wypełnia gniazd, ale
 * pilnujemy tego jawnie) i rzeczy, których nikt nie je samych z siebie.
 */
const ROLE_POMIJANE = new Set(["przyprawa"]);

/**
 * Role, które są tłem posiłku, a nie jego opisem — do nazwy nie wchodzą. „Jajecznica: olej
 * rzepakowy" to nie jest nazwa dania, tylko lista zakupów.
 */
const ROLE_POZA_NAZWA = new Set(["tluszcz", "sos", "pieczywo"]);

/**
 * Ile najmniej składnika z gniazda WYMAGANEGO, jako ułamek jego typowej porcji.
 * Bez tego solver schodził z wsadem do progu okrucha i wychodził „wrap: 15 g chorizo,
 * 15 g boczku" — formalnie dwa składniki białkowe, w praktyce pusta tortilla.
 */
const MIN_UDZIAL_TYPOWEJ_PORCJI = 0.5;

function losowy<T>(tablica: T[]): T {
  return tablica[Math.floor(Math.random() * tablica.length)];
}

function przetasuj<T>(tablica: T[]): T[] {
  const kopia = [...tablica];
  for (let i = kopia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [kopia[i], kopia[j]] = [kopia[j], kopia[i]];
  }
  return kopia;
}

/** Jednostka, w której podajemy ten składnik: jajko w sztukach, resztę w gramach. */
function jednostkaSkladnika(skladnik: Ingredient): JednostkaPorcji {
  return skladnik.masaSztuki ? "szt" : "g";
}

function makroNaJednostke(skladnik: Ingredient, jednostka: JednostkaPorcji): Makro {
  const gramy = jednostka === "szt" ? (skladnik.masaSztuki ?? 100) : 1;
  return skalujMakro(skladnik.makroNa100g, gramy / 100);
}

interface WybraneGniazda {
  /** Składniki w kolejności gniazd. */
  skladniki: Ingredient[];
  /** Te z gniazd wymaganych — mają zagwarantowaną minimalną porcję i nie wypadają jako okruchy. */
  rdzen: Set<string>;
  /** Składniki z pierwszego gniazda (baza dania) — nie trafiają do nazwy, bo jest w niej szablon. */
  baza: Set<string>;
}

/**
 * Wypełnia gniazda szablonu składnikami z bazy. Zwraca null, gdy któregoś **wymaganego**
 * gniazda nie ma czym zapełnić — przy ostrych restrykcjach (bez nabiału, bez glutenu)
 * to normalna sytuacja, wtedy po prostu bierzemy inny szablon.
 *
 * Lubiane składniki mają pierwszeństwo, ale nie wyłączność: gdyby wygrywały zawsze, user
 * z zaznaczonym twarogiem dostałby twaróg w każdym lekkim posiłku tygodnia.
 */
function wypelnijGniazda(
  szablon: SzablonDania,
  dostepne: Ingredient[],
  lubiane: Set<string>
): WybraneGniazda | null {
  const uzyte = new Set<string>();
  /** Kategorie zamienników już użyte — inaczej wychodziły „płatki owsiane + płatki owsiane bezglutenowe". */
  const uzyteKategorie = new Set<string>();
  const skladniki: Ingredient[] = [];
  const rdzen = new Set<string>();
  const baza = new Set<string>();

  for (let i = 0; i < szablon.gniazda.length; i++) {
    const gniazdo = szablon.gniazda[i];
    const pasujace = dostepne.filter(
      (s) =>
        s.rolaKulinarna !== undefined &&
        gniazdo.role.includes(s.rolaKulinarna) &&
        !uzyte.has(s.id) &&
        !(s.kategoria !== undefined && uzyteKategorie.has(s.kategoria)) &&
        !gniazdo.wykluczSkladniki?.includes(s.id)
    );

    if (pasujace.length === 0) {
      if (gniazdo.wymagane) return null;
      continue;
    }

    // Ile składników wchodzi do tego gniazda: wymagane biorą komplet, opcjonalne losowo
    // (stąd biorą się różnice między dniami), ale nigdy więcej niż pozwala `ile`.
    const sufit = gniazdo.ile ?? 1;
    let ile = gniazdo.wymagane ? Math.min(sufit, pasujace.length) : 0;
    if (!gniazdo.wymagane) {
      for (let k = 0; k < Math.min(sufit, pasujace.length); k++) {
        if (Math.random() < SZANSA_NA_DODATEK) ile++;
      }
    }
    if (ile === 0) continue;

    const lubianeNajpierw = przetasuj(pasujace).sort(
      (a, b) => Number(lubiane.has(b.id)) - Number(lubiane.has(a.id))
    );
    for (const skladnik of lubianeNajpierw.slice(0, ile)) {
      skladniki.push(skladnik);
      uzyte.add(skladnik.id);
      if (skladnik.kategoria) uzyteKategorie.add(skladnik.kategoria);
      if (gniazdo.wymagane) rdzen.add(skladnik.id);
      if (i === 0) baza.add(skladnik.id);
    }
  }

  return skladniki.length > 0 ? { skladniki, rdzen, baza } : null;
}

/**
 * Nazwa gotowca: „Kanapki: szynka, ser żółty, pomidor".
 *
 * Świadomie z dwukropkiem, a nie „Kanapki z szynką i serem" — nazwy składników w bazie są
 * w mianowniku, a odmiana przez przypadki wymagałaby słownika fleksyjnego. Lepiej brzmieć
 * telegraficznie niż kaleczyć język.
 */
/**
 * Nazwy w bazie mają dopiski w nawiasach („Kasza gryczana (surowa)", „Mięso mielone wołowe
 * (chude)") — w nazwie dania wyglądają jak błąd, więc je ucinamy.
 */
function bezNawiasu(nazwa: string): string {
  return nazwa.replace(/\s*\([^)]*\)/g, "").trim();
}

function zbudujNazwe(szablon: SzablonDania, wybrane: WybraneGniazda): string {
  const opisowe = wybrane.skladniki.filter(
    (s) => !wybrane.baza.has(s.id) && !ROLE_POZA_NAZWA.has(s.rolaKulinarna ?? "")
  );
  const doNazwy = (opisowe.length > 0 ? opisowe : wybrane.skladniki).slice(0, 3);
  if (doNazwy.length === 0) return szablon.nazwa;
  return `${szablon.nazwa}: ${doNazwy.map((s) => bezNawiasu(s.nazwa).toLowerCase()).join(", ")}`;
}

function zbudujPozycje(skladniki: Ingredient[], cel: Makro, rdzen: Set<string>): PozycjaDoDobrania[] {
  return skladniki.map((skladnik) => {
    const jednostka = jednostkaSkladnika(skladnik);
    const wRdzeniu = rdzen.has(skladnik.id);
    const granice = granicePozycji({
      rola: skladnik.rolaKulinarna,
      jednostka,
      celSlotu: cel,
      wRdzeniu,
      sufitSkladnika: naJednostke(skladnik.maksPorcja, jednostka, skladnik.masaSztuki),
      porcjaTypowa: naJednostke(skladnik.porcjaTypowa, jednostka, skladnik.masaSztuki),
    });

    // Składnik z gniazda wymaganego dostaje podłogę liczoną od jego typowej porcji, a nie
    // sam próg okrucha — patrz MIN_UDZIAL_TYPOWEJ_PORCJI.
    const min =
      wRdzeniu && granice.preferowana !== undefined
        ? Math.min(granice.max, Math.max(granice.min, granice.preferowana * MIN_UDZIAL_TYPOWEJ_PORCJI))
        : granice.min;

    return {
      id: skladnik.id,
      makroNaJednostke: makroNaJednostke(skladnik, jednostka),
      ilosc: granice.start,
      min,
      max: granice.max,
      krok: granice.krok,
      preferowana: granice.preferowana,
    };
  });
}

/**
 * Solver dostraja cztery cele naraz i potrafi zostawić „okruchy" (5 g pomidora, 10 g szynki).
 * Wyrzucamy je i liczymy jeszcze raz, żeby resztę rozłożyć na nowo — tak samo jak w trybie
 * „z lodówki".
 */
function rozwiazBezOkruchow(skladniki: Ingredient[], cel: Makro, rdzen: Set<string>) {
  let aktualne = skladniki;
  let wynik = dobierzIlosci(zbudujPozycje(aktualne, cel, rdzen), cel);

  for (let przebieg = 0; przebieg < 2; przebieg++) {
    const zostajace = aktualne.filter((skladnik, k) => {
      if (rdzen.has(skladnik.id)) return true;
      const prog = jednostkaSkladnika(skladnik) === "szt" ? 1 : MIN_SENSOWNA_PORCJA_G;
      return wynik.pozycje[k].ilosc >= prog;
    });
    if (zostajace.length === aktualne.length || zostajace.length === 0) break;
    aktualne = zostajace;
    wynik = dobierzIlosci(zbudujPozycje(aktualne, cel, rdzen), cel);
  }

  return { wynik, skladniki: aktualne };
}

export interface ZapytanieOGotowiec {
  slot: string;
  cel: Makro;
  filtr: FiltrSkladnikow;
  /** Id szablonów użytych już dziś albo w tym tygodniu — omijamy je, o ile jest z czego wybierać. */
  wyklucz?: Set<string>;
  /** Sprzęt, którego user nie ma — koktajl bez blendera nie powstanie. */
  bezSprzetu?: Sprzet[];
  lubianeSkladniki?: string[];
}

/**
 * Składa jeden gotowiec na dany slot. Zwraca null, gdy z dopuszczalnych składników nie da się
 * złożyć żadnego szablonu (np. przy bardzo ostrych restrykcjach).
 */
export function zlozGotowiec(zapytanie: ZapytanieOGotowiec): Gotowiec | null {
  const lubiane = new Set(zapytanie.lubianeSkladniki ?? []);
  const dostepne = getIngredients().filter(
    (s) =>
      s.rolaKulinarna !== undefined &&
      !ROLE_POMIJANE.has(s.rolaKulinarna) &&
      // Odżywka białkowa wchodzi tylko wtedy, gdy user sam ją zaznaczył jako lubianą.
      // Inaczej silnik „domykał" białko sypnięciem whey do koktajlu — a ta apka ma pomagać
      // jeść zdrowiej, nie robić z każdego posiłku suplementacji.
      (s.rolaKulinarna !== "odzywka" || lubiane.has(s.id)) &&
      !skladnikOdrzucony(s, zapytanie.filtr)
  );

  const brakujacySprzet = new Set(zapytanie.bezSprzetu ?? []);
  const naSlot = getSzablony().filter(
    (s) => s.sloty.includes(zapytanie.slot) && !s.sprzet?.some((x) => brakujacySprzet.has(x))
  );
  if (naSlot.length === 0 || dostepne.length === 0) return null;

  // Powtórki odcinamy twardo, ale tylko gdy jest z czego wybierać — przy jednym dostępnym
  // szablonie lepiej powtórzyć kanapkę niż zostawić slot pusty.
  const bezPowtorek = naSlot.filter((s) => !zapytanie.wyklucz?.has(s.id));
  const pula = bezPowtorek.length > 0 ? bezPowtorek : naSlot;

  const propozycje: Gotowiec[] = [];

  for (const szablon of przetasuj(pula)) {
    if (propozycje.length >= ILE_PROPOZYCJI) break;
    // Kanapka z surowym boczkiem i surowymi pieczarkami — dokładnie to wychodziło,
    // zanim składniki dostały flagę `wymagaGotowania`.
    const doSzablonu = dostepne.filter((s) => (szablon.naZimno ? !s.wymagaGotowania : !s.tylkoNaZimno));

    for (let proba = 0; proba < PROBY_NA_SZABLON; proba++) {
      const wybrane = wypelnijGniazda(szablon, doSzablonu, lubiane);
      if (!wybrane) break; // brak składników do gniazd wymaganych nie naprawi się kolejną próbą

      const { wynik, skladniki } = rozwiazBezOkruchow(wybrane.skladniki, zapytanie.cel, wybrane.rdzen);
      const pozycje = skladniki
        .map((skladnik, k) => ({ skladnik, dobrana: wynik.pozycje[k] }))
        .filter(({ dobrana }) => dobrana.ilosc > 0);
      if (pozycje.length === 0) continue;

      let makro = pustaMakro();
      const wynikowe: SkladnikGotowca[] = [];
      for (const { skladnik, dobrana } of pozycje) {
        makro = dodajMakro(makro, dobrana.makro);
        wynikowe.push({
          skladnikId: skladnik.id,
          nazwa: skladnik.nazwa,
          ilosc: dobrana.ilosc,
          jednostka: jednostkaSkladnika(skladnik),
        });
      }

      propozycje.push({
        szablonId: szablon.id,
        nazwa: zbudujNazwe(szablon, { ...wybrane, skladniki: pozycje.map((p) => p.skladnik) }),
        skladniki: wynikowe,
        makro,
        instrukcje: szablon.instrukcje,
        naZimno: szablon.naZimno === true && !szablon.sprzet?.length,
        najwiekszeOdchylenie: wynik.najwiekszeOdchylenie,
      });
      break; // z jednego szablonu bierzemy jedną propozycję — reszta puli daje różnorodność
    }
  }

  if (propozycje.length === 0) return null;
  return propozycje.reduce((a, b) => (b.najwiekszeOdchylenie < a.najwiekszeOdchylenie ? b : a));
}
