import { getComponentById, getIngredients, getRecipes, getSzablony } from "./data";
import { makroNaJednostke, type JednostkaKreatora } from "./kreator";
import type { SkladnikBazowyWPlanie } from "./lista-zakupow";
import { dodajMakro, makroSkladnikaProstego, masaWGramach, pustaMakro, skalujMakro } from "./macro";
import {
  obliczKcalDzienne,
  obliczMakroDzienne,
  rozbijNaSloty,
  type DaneAntropometryczne,
  type PosilekWPlanie,
  type RozkladMakroProcentowy,
  type SkladnikWPlanie,
} from "./planner";
import { zaproponujDokupienie, type PropozycjeDokupienia } from "./propozycje-dokupienia";
import { dobierzIlosci, type PozycjaDoDobrania } from "./solver";
import { maZakazanyAlergen, pobierzPozycjeSpizarni } from "./spizarnia";
import {
  jestGrupaWyboru,
  jestKomponentem,
  type Ingredient,
  type Makro,
  type PozycjaSpizarni,
  type Recipe,
  type SzablonDania,
} from "./types";

/**
 * Tryb "z lodówki" — proces odwrócony względem planera.
 *
 * Planer idzie: cel makro → dobierz przepisy → policz składniki.
 * Tutaj: cel makro + koszyk tego, co user MA → złóż z tego sensowne dania → dobierz gramatury.
 *
 * Na pierwszym miejscu są **przepisy z `recipes.json`** — te, które da się zrobić z koszyka.
 * Skalujemy je w całości jednym mnożnikiem (proporcje są częścią przepisu) i przepisujemy
 * ich instrukcje, bo o gotowanie wg przepisu tu chodzi.
 *
 * **Szablony dań** (`data/szablony.json`) są fallbackiem na sytuację "z tego nie da się zrobić
 * żadnego przepisu, ale da się zjeść sensowny posiłek": archetypy z gniazdami na role kulinarne,
 * nie na konkretne składniki. Pilnują, żeby nie powstała "szynka z ryżem i mlekiem" — nie ma
 * szablonu z takim zestawem gniazd. Wcześniejsze podejście (rola z makro + powinowactwo do slotu
 * + osobno słodkie/wytrawne) zostało wyrzucone: opisywało **pojedyncze składniki**, a problem
 * jest z natury **parami**.
 *
 * Dopasowanie makro jest tu wskazówką, nie wyrocznią — patrz WAGA_ROZJAZDU.
 */

export type JednostkaKoszyka = Extract<JednostkaKreatora, "g" | "szt">;

export interface PozycjaKoszyka {
  /** Id ze spiżarni: składnik bazowy ("kurczak-piers") albo produkt z OFF ("off:590..."). */
  id: string;
  jednostka: JednostkaKoszyka;
  /**
   * Ile tego masz na cały dzień. Brak = "mam dość, dobierz ile trzeba" — wtedy silnik
   * ogranicza się tylko sufitem kulinarnym, żeby nie wsypać 800 g oliwy dla samych kcal.
   */
  dostepneIlosc?: number;
}

export interface ZapytanieZLodowki {
  kcalDzienne?: number;
  dane?: DaneAntropometryczne;
  makro?: RozkladMakroProcentowy;
  sloty: string[];
  koszyk: PozycjaKoszyka[];
  /** Tylko do ostrzeżeń — w tym trybie user wybiera jedzenie sam, więc nic nie filtrujemy za niego. */
  restrykcje?: string[];
}

export interface ResztkaWLodowce {
  id: string;
  nazwa: string;
  zostalo: number;
  jednostka: JednostkaKoszyka;
}

export interface DzienZLodowki {
  kcalDzienne: number;
  makroDzienne: Makro;
  celeSlotow: Record<string, Makro>;
  posilki: PosilekWPlanie[];
  makroDnia: Makro;
  /** Co zostaje z zadeklarowanych zapasów po rozpisaniu dnia. */
  resztki: ResztkaWLodowce[];
  /** Przepisy, do których brakuje kilku składników — „dokup X i zrobisz Y". */
  propozycje: PropozycjeDokupienia;
  ostrzezenia: string[];
}

/**
 * Powyżej tego rozjazdu (w %) mówimy o nim wprost. Próg jest świadomie luźny: pojedynczy
 * posiłek nie musi trafiać co do grama, a ktoś, kto je z apetytem sensowne dania, wyjdzie
 * na tym lepiej niż ktoś, komu silnik wcisnął idealnie policzoną potrawę, której nie tknie.
 */
const PROG_OSTRZEZENIA_PROCENT = 20;

/**
 * Dla przepisu próg jest wyższy, bo rozjazd jest tam **naturalny i nie do naprawienia**:
 * przepis skalujemy w całości, więc user nie może nic dorzucić, żeby go poprawić. Ostrzeganie
 * przy każdym daniu byłoby szumem, przez który przestałby czytać ostrzeżenia w ogóle.
 * Przy szablonie jest inaczej — tam dorzucenie składnika realnie pomaga, więc mówimy wcześniej.
 */
const PROG_OSTRZEZENIA_PRZEPISU = 40;

const KROK_JEDNOSTKI: Record<JednostkaKoszyka, number> = { g: 5, szt: 1 };

/**
 * Ile najwyżej danego składnika w JEDNYM posiłku, gdy user nie podał własnego zapasu (w gramach).
 * Bez tego solver dobija kcal czym popadnie i wychodzi 400 g ogórka albo 90 g oliwy —
 * matematycznie poprawne, kulinarnie bez sensu.
 */
const SUFIT_ROLI: Record<string, number> = {
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
const SUFIT_DOMYSLNY = 200;
const SUFIT_SZTUK = 6;

/** Poniżej tylu gramów pozycja jest okruchem, nie składnikiem — wypada z posiłku. */
const MIN_SENSOWNA_PORCJA_G = 15;

/**
 * Wagi wyboru szablonu. Rozjazd od celu (dzielony przez 2) jest głównym kryterium, ale te dwie
 * przeciwwagi są tu z konkretnego powodu: bez nich silnik dawał jajecznicę na śniadanie
 * *i* na kolację, zostawiając nietknięte płatki, mleko i banana. Lekki rozjazd makro jest
 * mniej dotkliwy niż ten sam posiłek dwa razy dziennie i połowa lodówki niewykorzystana.
 */
const WAGA_SWIEZOSCI = 3;
const KARA_ZA_POWTORKE = 10;

/**
 * Jak mocno rozjazd od celu makro wpływa na wybór dania. Celowo NISKO (dzielimy przez 6):
 * dopasowanie makro jest wskazówką, a nie wyrocznią. Wcześniej ważyło trzy razy tyle i skutek
 * był taki, że wygrywały zawsze te same 2-3 zestawy, które akurat idealnie trafiały w cel,
 * a reszta bazy nie wypadała nigdy. Lepiej zjeść coś, na co ma się ochotę, i mieć jeden dzień
 * z mniejszym białkiem, niż dostać w kółko to samo.
 */
const WAGA_ROZJAZDU = 1 / 6;

/**
 * Spośród kandydatów w tym promieniu od najlepszej oceny losujemy. Bez tego wybór jest
 * deterministyczny i to samo danie wychodzi przy każdym kliknięciu "przelicz jeszcze raz".
 */
const PROMIEN_LOSOWANIA = 10;

function losujSposrodNajlepszych<T>(ocenione: { wybor: T; ocena: number }[]): T {
  const najlepsza = Math.max(...ocenione.map((k) => k.ocena));
  const pula = ocenione.filter((k) => k.ocena >= najlepsza - PROMIEN_LOSOWANIA);
  return pula[Math.floor(Math.random() * pula.length)].wybor;
}

/**
 * Przepis z kuratorowanej bazy jest wart więcej niż szablon o podobnym dopasowaniu: daje realne
 * instrukcje przygotowania i został przemyślany przez człowieka. Szablon zostaje fallbackiem
 * na sytuację "z tego nie da się zrobić żadnego przepisu, ale da się zjeść sensowny posiłek".
 */
const BONUS_ZA_PRZEPIS = 12;

/**
 * Sufity wyżej są podane dla "przeciętnego" posiłku ~600 kcal i skalują się z celem slotu:
 * 250 g mięsa jest sensowne na obiad 600 kcal, ale na obiad 1200 kcal to już za mało.
 * Mnożnik jest przycięty, żeby przy skrajnych celach nie wyszło 900 g piersi ani 40 g ryżu.
 */
const KCAL_REFERENCYJNE_POSILKU = 600;
const MIN_MNOZNIK_SUFITU = 0.6;
const MAKS_MNOZNIK_SUFITU = 2;

/**
 * Gramatura, którą da się odmierzyć w kuchni. "19,3 g mąki" jest formalnie dokładniejsze,
 * ale nikt tego nie odważy — a przy przepisie skalowanym w całości ta dokładność i tak jest
 * pozorna. Im większa ilość, tym grubszy krok.
 */
function zaokraglijKuchennie(ilosc: number, jednostka: string): number {
  if (jednostka === "szt") return Math.max(1, Math.round(ilosc));
  if (ilosc < 10) return Math.max(1, Math.round(ilosc));
  const krok = ilosc < 100 ? 5 : 10;
  return Math.round(ilosc / krok) * krok;
}

/**
 * To samo co `zaokraglijKuchennie`, ale zawsze w dół — do przycinania ilości zapasem.
 * Zaokrąglenie w górę potrafi wyprowadzić poza lodówkę: 118 g piersi zaokrąglone do 120 g
 * to plan, którego user nie wykona, bo tyle mięsa po prostu nie ma.
 */
function zaokraglijWDol(ilosc: number, jednostka: string): number {
  if (jednostka === "szt") return Math.max(0, Math.floor(ilosc));
  if (ilosc < 10) return Math.max(0, Math.floor(ilosc));
  const krok = ilosc < 100 ? 5 : 10;
  return Math.floor(ilosc / krok) * krok;
}

function mnoznikSufitu(celSlotu: Makro): number {
  const surowy = celSlotu.kcal / KCAL_REFERENCYJNE_POSILKU;
  return Math.min(MAKS_MNOZNIK_SUFITU, Math.max(MIN_MNOZNIK_SUFITU, surowy));
}

/**
 * Granice jednej pozycji dla solvera — wspólne dla planowania dnia i dla ręcznego przeliczania,
 * żeby po zmianie gramatury przez usera obowiązywały dokładnie te same sufity kulinarne.
 */
function granicePozycji(opcje: {
  rola?: string;
  jednostka: JednostkaKoszyka;
  celSlotu: Makro;
  /** Limit wynikający z zadeklarowanego zapasu, już podzielony między posiłki. */
  limitZZapasu?: number;
  /** Składnik z wymaganego gniazda szablonu — ma zagwarantowaną minimalną porcję. */
  wRdzeniu: boolean;
  /** `maksPorcja` składnika, przeliczona na jednostkę koszyka. Nadpisuje sufit roli. */
  sufitSkladnika?: number;
  /** `porcjaTypowa` składnika, przeliczona na jednostkę koszyka. */
  porcjaTypowa?: number;
}): { min: number; max: number; krok: number; start: number; preferowana?: number } {
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

const NAZWY_CELOW: Record<keyof Makro, string> = {
  kcal: "kalorii",
  bialko: "białka",
  tluszcz: "tłuszczu",
  wegle: "węglowodanów",
};

/**
 * "brakuje 48% białka" zamiast "największy rozjazd to 48%" — user ma wiedzieć, co dorzucić
 * do koszyka, a nie tylko że coś się nie zgadza.
 */
function opiszRozjazd(odchylenia: Record<keyof Makro, number>): string {
  const istotne = (Object.keys(NAZWY_CELOW) as (keyof Makro)[])
    .map((cel) => ({ cel, wartosc: odchylenia[cel] }))
    .filter(({ wartosc }) => Math.abs(wartosc) > PROG_OSTRZEZENIA_PROCENT)
    .sort((a, b) => Math.abs(b.wartosc) - Math.abs(a.wartosc));

  if (istotne.length === 0) return "nie da się trafić w cel";

  return istotne
    .map(({ cel, wartosc }) =>
      wartosc < 0
        ? `brakuje ${Math.round(-wartosc)}% ${NAZWY_CELOW[cel]}`
        : `o ${Math.round(wartosc)}% za dużo ${NAZWY_CELOW[cel]}`
    )
    .join(", ");
}

interface PozycjaRozwiazana {
  wejscie: PozycjaKoszyka;
  zeSpizarni: PozycjaSpizarni;
  /** Brak dla produktów z Open Food Facts — nikt nie otagował 4800 pozycji. */
  rola?: string;
  /** Dołożone automatycznie jako "każdy to ma w domu", nie wybrane przez usera. */
  zDomu?: boolean;
  /** Z `ingredients.json`, zawsze w gramach — niezależnie od jednostki koszyka. */
  porcjaTypowa?: number;
  maksPorcja?: number;
}

function nazwaWyswietlana(pozycja: PozycjaSpizarni): string {
  return pozycja.marka ? `${pozycja.nazwa} (${pozycja.marka})` : pozycja.nazwa;
}

/**
 * Składniki bazowe po id. Poza rolą kulinarną potrzebne są stąd jeszcze `porcjaTypowa`
 * i `maksPorcja`, więc trzymamy cały wpis zamiast samej roli.
 */
function mapaSkladnikow(): Map<string, Ingredient> {
  return new Map(getIngredients().map((skladnik) => [skladnik.id, skladnik]));
}

/** Przelicza gramy z bazy na jednostkę, w której user trzyma tę pozycję w koszyku. */
function naJednostkeKoszyka(
  gramy: number | undefined,
  jednostka: JednostkaKoszyka,
  masaSztuki?: number
): number | undefined {
  if (gramy === undefined) return undefined;
  if (jednostka !== "szt") return gramy;
  return masaSztuki ? gramy / masaSztuki : undefined;
}

interface DopasowanySzablon {
  szablon: SzablonDania;
  /** Indeksy pozycji koszyka wybrane do tego posiłku, w kolejności gniazd. */
  indeksy: number[];
  /**
   * Składniki z gniazd WYMAGANYCH — bez nich danie przestaje być tym daniem.
   * Owsianka bez płatków to nie owsianka, więc te pozycje mają gwarantowaną minimalną
   * gramaturę i nie wypadają przy usuwaniu okruchów.
   */
  rdzen: Set<number>;
  /** Ile składników z koszyka nie było jeszcze użytych dziś (im więcej, tym lepiej). */
  swiezych: number;
  /** Ile gniazd udało się zapełnić (pełniejsze danie = ciekawsze). */
  wypelnionych: number;
}

/**
 * Próbuje wypełnić szablon składnikami z koszyka. Zwraca null, gdy któregoś **wymaganego**
 * gniazda nie ma czym zapełnić — wtedy tego dania po prostu nie da się dziś zrobić.
 *
 * Przy wyborze preferujemy składniki jeszcze nieużyte w tym dniu: dzięki temu koszyk się
 * "rozchodzi" po posiłkach, zamiast wciskać ten sam ser do każdego z nich.
 */
function dopasujSzablon(
  szablon: SzablonDania,
  rozwiazane: PozycjaRozwiazana[],
  uzyteDzis: Set<number>
): DopasowanySzablon | null {
  const wybrane: number[] = [];
  const zajete = new Set<number>();
  const rdzen = new Set<number>();
  let swiezych = 0;
  let wypelnionych = 0;

  for (const gniazdo of szablon.gniazda) {
    const pasujace = rozwiazane
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => !zajete.has(i) && p.rola !== undefined && gniazdo.role.includes(p.rola))
      .sort((a, b) => Number(uzyteDzis.has(a.i)) - Number(uzyteDzis.has(b.i)))
      .map(({ i }) => i);

    if (gniazdo.wymagane && pasujace.length === 0) return null;

    for (const indeks of pasujace.slice(0, gniazdo.ile ?? 1)) {
      wybrane.push(indeks);
      zajete.add(indeks);
      if (gniazdo.wymagane) rdzen.add(indeks);
      // Olej z domowej półki nie jest "świeżym produktem do zużycia" — inaczej premia
      // za różnorodność przechylałaby wybór ku daniom, które mają gniazdo tłuszczu.
      if (!uzyteDzis.has(indeks) && !rozwiazane[indeks].zDomu) swiezych++;
    }
    if (pasujace.length > 0) wypelnionych++;
  }

  return { szablon, indeksy: wybrane, rdzen, swiezych, wypelnionych };
}

interface PozycjaPrzepisu {
  skladnikId: string;
  /** Ilość dla całego przepisu (przed przeskalowaniem do celu slotu). */
  ilosc: number;
  jednostka: string;
  /** Indeks w koszyku — do liczenia zużycia zapasu i „świeżości". */
  indeks: number;
}

/**
 * Czy da się zrobić ten przepis z tego, co user ma. Zwraca null, gdy brakuje choćby jednego
 * składnika — przepis to przepis, nie da się go zrobić „prawie".
 *
 * Grupy wyboru rozwiązujemy **pod dostępność**, a nie pod domyślny wybór przepisu: skoro user
 * ma mąkę owsianą, a nie pszenną, to naleśniki robimy na owsianej. Komponenty (ciasto) wymagają
 * kompletu swoich surowców.
 */
function dopasujPrzepisDoKoszyka(przepis: Recipe, wKoszyku: Map<string, number>): PozycjaPrzepisu[] | null {
  const skladniki = getIngredients();
  const pozycje: PozycjaPrzepisu[] = [];

  for (const pos of przepis.skladniki) {
    if (jestGrupaWyboru(pos)) {
      const zKategorii = skladniki.filter((s) => s.kategoria === pos.kategoria && wKoszyku.has(s.id));
      const wybrany = zKategorii.find((s) => s.id === pos.domyslnaSkladnikId) ?? zKategorii[0];
      if (!wybrany) return null;
      pozycje.push({
        skladnikId: wybrany.id,
        ilosc: pos.ilosc,
        jednostka: pos.jednostka,
        indeks: wKoszyku.get(wybrany.id)!,
      });
      continue;
    }

    if (jestKomponentem(pos)) {
      const komponent = getComponentById(pos.komponentId);
      const proporcja = pos.ilosc / komponent.iloscWynikowa;
      for (const surowiec of komponent.skladniki) {
        const indeks = wKoszyku.get(surowiec.skladnikId);
        if (indeks === undefined) return null;
        pozycje.push({
          skladnikId: surowiec.skladnikId,
          ilosc: surowiec.ilosc * proporcja,
          jednostka: surowiec.jednostka,
          indeks,
        });
      }
      continue;
    }

    const indeks = wKoszyku.get(pos.skladnikId);
    if (indeks === undefined) return null;
    pozycje.push({ skladnikId: pos.skladnikId, ilosc: pos.ilosc, jednostka: pos.jednostka, indeks });
  }

  return pozycje;
}

/** Co silnik wybrał na dany slot: przepis z bazy albo — gdy żaden nie pasuje — szablon dania. */
type WyborSlotu =
  | { rodzaj: "przepis"; przepis: Recipe; pozycje: PozycjaPrzepisu[]; wspolczynnik: number; makro: Makro; odchylenie: number }
  | { rodzaj: "szablon"; dopasowanie: DopasowanySzablon };

/** Identyfikator dania — przepisu albo szablonu — do pilnowania powtórek w obrębie dnia. */
function idDania(wybor: WyborSlotu): string {
  return wybor.rodzaj === "przepis" ? wybor.przepis.id : wybor.dopasowanie.szablon.id;
}

function indeksyWyboru(wybor: WyborSlotu): number[] {
  return wybor.rodzaj === "przepis"
    ? [...new Set(wybor.pozycje.map((p) => p.indeks))]
    : wybor.dopasowanie.indeksy;
}

function makroPozycjiPrzepisu(pozycje: PozycjaPrzepisu[]): Makro {
  return pozycje.reduce(
    (suma, p) => dodajMakro(suma, makroSkladnikaProstego({ skladnikId: p.skladnikId, ilosc: p.ilosc, jednostka: p.jednostka })),
    pustaMakro()
  );
}

export function rozpiszZLodowki(zapytanie: ZapytanieZLodowki): DzienZLodowki {
  if (zapytanie.sloty.length === 0) throw new Error("Podaj przynajmniej jeden slot posiłku");
  if (zapytanie.koszyk.length === 0) throw new Error("Koszyk jest pusty — dodaj to, co masz w lodówce");

  const restrykcje = zapytanie.restrykcje ?? [];
  const kcalDzienne = obliczKcalDzienne(zapytanie);
  const makroDzienne = obliczMakroDzienne(kcalDzienne, zapytanie.makro);
  const celeSlotow = rozbijNaSloty(makroDzienne, zapytanie.sloty);
  const ostrzezenia: string[] = [];

  const skladnikiBazy = mapaSkladnikow();
  const rozwiazane: PozycjaRozwiazana[] = zapytanie.koszyk.map((wejscie) => {
    const zeSpizarni = pobierzPozycjeSpizarni(wejscie.id);
    if (wejscie.jednostka === "szt" && !zeSpizarni.masaSztuki) {
      throw new Error(`"${zeSpizarni.nazwa}" nie ma zdefiniowanej masy sztuki — podaj ilość w gramach`);
    }
    if (wejscie.dostepneIlosc !== undefined && wejscie.dostepneIlosc <= 0) {
      throw new Error(`Nieprawidłowa dostępna ilość dla "${zeSpizarni.nazwa}"`);
    }

    if (maZakazanyAlergen(zeSpizarni, restrykcje)) {
      const zakazane = zeSpizarni.tagiAlergenow.filter((t) => restrykcje.includes(t));
      ostrzezenia.push(`${nazwaWyswietlana(zeSpizarni)} zawiera: ${zakazane.join(", ")} — masz to na liście restrykcji.`);
    }

    const zBazy = skladnikiBazy.get(wejscie.id);
    return {
      wejscie,
      zeSpizarni,
      rola: zBazy?.rolaKulinarna,
      porcjaTypowa: zBazy?.porcjaTypowa,
      maksPorcja: zBazy?.maksPorcja,
    };
  });

  /**
   * Dokładamy podstawowe zapasy (olej, oliwa), o ile user sam ich nie dodał. Bez tego szablon
   * jajecznicy wypełniał tylko gniazda, które da się wypełnić z koszyka, i wychodziło samo
   * jajko ze szpinakiem — bo nikt nie wpisuje oleju do lodówki.
   *
   * Nie mają `dostepneIlosc`, więc ogranicza je wyłącznie sufit kulinarny (25 g × mnożnik),
   * i nie wchodzą do resztek ani do ostrzeżeń o niewykorzystanym koszyku.
   */
  const wKoszyku = new Set(zapytanie.koszyk.map((p) => p.id));
  for (const skladnik of getIngredients()) {
    if (!skladnik.zawszeWDomu || wKoszyku.has(skladnik.id)) continue;
    rozwiazane.push({
      wejscie: { id: skladnik.id, jednostka: "g" },
      zeSpizarni: pobierzPozycjeSpizarni(skladnik.id),
      rola: skladnik.rolaKulinarna,
      zDomu: true,
    });
  }

  /**
   * `limitDla` mówi, ile tego składnika wolno zużyć w TYM posiłku (w jednostce koszyka).
   * Przy ocenie kandydatów przypisanie slotów nie jest jeszcze gotowe, więc liczymy jak dla
   * pełnego zapasu; finalne przeliczenie idzie już z realnym podziałem — patrz `udzialNaPosilek`.
   */
  const zbudujPozycje = (
    indeksy: number[],
    celSlotu: Makro,
    limitDla: (indeks: number) => number | undefined,
    rdzen: Set<number>
  ): PozycjaDoDobrania[] => {
    return indeksy.map((i) => {
      const { wejscie, rola, zeSpizarni, porcjaTypowa, maksPorcja } = rozwiazane[i];
      const limitZZapasu = limitDla(i);
      const granice = granicePozycji({
        rola,
        jednostka: wejscie.jednostka,
        celSlotu,
        limitZZapasu,
        wRdzeniu: rdzen.has(i),
        sufitSkladnika: naJednostkeKoszyka(maksPorcja, wejscie.jednostka, zeSpizarni.masaSztuki),
        porcjaTypowa: naJednostkeKoszyka(porcjaTypowa, wejscie.jednostka, zeSpizarni.masaSztuki),
      });

      return {
        id: String(i),
        makroNaJednostke: makroNaJednostke(zeSpizarni, wejscie.jednostka),
        ilosc: granice.start,
        min: granice.min,
        max: granice.max,
        krok: granice.krok,
        preferowana: granice.preferowana,
      };
    });
  };

  /**
   * Solver, rozwiązując pod cztery cele naraz, potrafi zostawić "okruchy": 5 g pomidora,
   * 10 g szynki. Matematycznie to poprawne dostrojenie, ale nikt tego nie odważy ani nie zje.
   * Wyrzucamy takie pozycje z zestawu i liczymy jeszcze raz, żeby resztę składników rozłożyć
   * na nowo — dzięki temu makro dalej się zgadza, tylko na sensownych gramaturach.
   */
  const rozwiazBezOkruchow = (
    indeksy: number[],
    cel: Makro,
    limitDla: (i: number) => number | undefined,
    rdzen: Set<number>
  ) => {
    let aktualne = indeksy;
    let wynik = dobierzIlosci(zbudujPozycje(aktualne, cel, limitDla, rdzen), cel);

    for (let przebieg = 0; przebieg < 2; przebieg++) {
      const zostajace = aktualne.filter((indeks, k) => {
        if (rdzen.has(indeks)) return true;
        const prog = rozwiazane[indeks].wejscie.jednostka === "szt" ? 1 : MIN_SENSOWNA_PORCJA_G;
        return wynik.pozycje[k].ilosc >= prog;
      });
      if (zostajace.length === aktualne.length || zostajace.length === 0) break;
      aktualne = zostajace;
      wynik = dobierzIlosci(zbudujPozycje(aktualne, cel, limitDla, rdzen), cel);
    }

    return { wynik, indeksy: aktualne };
  };

  /** Limit „masz tego tyle, ile masz" — do oceniania kandydatów, zanim znamy podział na sloty. */
  const pelnyZapas = (i: number): number | undefined => rozwiazane[i].wejscie.dostepneIlosc;

  const szablony = getSzablony();
  const uzyteDzis = new Set<number>();
  const uzyteDania = new Set<string>();

  /** Gdzie w koszyku leży dany składnik bazowy — do dopasowywania przepisów. */
  const pozycjeKoszyka = new Map<string, number>();
  rozwiazane.forEach((p, i) => {
    if (!pozycjeKoszyka.has(p.wejscie.id)) pozycjeKoszyka.set(p.wejscie.id, i);
  });

  const przepisy = getRecipes().filter((r) => (r.kategoriaDania ?? "glowne") === "glowne");

  /**
   * Przeskalowanie przepisu do celu slotu. Przepis skalujemy **jednym mnożnikiem**, a nie
   * solverem: proporcje są częścią przepisu i nie wolno dosypać mąki, zostawiając jajka.
   * Mnożnik przycinamy zapasem — jeśli user ma 200 g mąki, nie każemy mu użyć 300 g.
   */
  function przygotujPrzepis(przepis: Recipe, pozycje: PozycjaPrzepisu[], cel: Makro) {
    const makroCalego = makroPozycjiPrzepisu(pozycje);
    if (makroCalego.kcal <= 0) return null;

    let wspolczynnik = cel.kcal / makroCalego.kcal;
    for (const pozycja of pozycje) {
      const { wejscie, zeSpizarni } = rozwiazane[pozycja.indeks];
      if (wejscie.dostepneIlosc === undefined) continue;
      const maGramow = masaWGramach(zeSpizarni, wejscie.dostepneIlosc, wejscie.jednostka);
      const trzebaGramow = masaWGramach(zeSpizarni, pozycja.ilosc, pozycja.jednostka);
      if (trzebaGramow > 0) wspolczynnik = Math.min(wspolczynnik, maGramow / trzebaGramow);
    }
    if (wspolczynnik <= 0) return null;

    const makro = skalujMakro(makroCalego, wspolczynnik);
    const odchylenie = Math.max(
      ...(["kcal", "bialko", "tluszcz", "wegle"] as const).map((c) =>
        cel[c] > 0 ? Math.abs(((makro[c] - cel[c]) / cel[c]) * 100) : 0
      )
    );
    return { wspolczynnik, makro, odchylenie };
  }

  /** Wybrane danie na slot (null = nie dało się nic złożyć). */
  const planSlotow = new Map<string, WyborSlotu | null>();

  for (const slot of zapytanie.sloty) {
    const cel = celeSlotow[slot];
    const ocenione: { wybor: WyborSlotu; ocena: number }[] = [];

    const swiezosc = (indeksy: number[]) =>
      new Set(indeksy.filter((i) => !uzyteDzis.has(i) && !rozwiazane[i].zDomu)).size;

    /**
     * Przepis z kuratorowanej bazy bije szablon przy zbliżonym dopasowaniu — bo daje realne
     * instrukcje przygotowania i jest przemyślany przez człowieka. Szablon jest tu fallbackiem
     * na sytuację "z tego, co masz, nie da się zrobić żadnego przepisu, ale da się zjeść posiłek".
     */
    for (const przepis of przepisy) {
      if (!przepis.slot.includes(slot)) continue;
      const pozycje = dopasujPrzepisDoKoszyka(przepis, pozycjeKoszyka);
      if (!pozycje) continue;
      const przygotowany = przygotujPrzepis(przepis, pozycje, cel);
      if (!przygotowany) continue;

      const indeksy = [...new Set(pozycje.map((p) => p.indeks))];
      ocenione.push({
        wybor: { rodzaj: "przepis", przepis, pozycje, ...przygotowany },
        ocena:
          -przygotowany.odchylenie * WAGA_ROZJAZDU +
          swiezosc(indeksy) * WAGA_SWIEZOSCI +
          BONUS_ZA_PRZEPIS -
          (uzyteDania.has(przepis.id) ? KARA_ZA_POWTORKE : 0),
      });
    }

    /**
     * Sam fakt, że danie da się złożyć, nie znaczy, że ma sens na TEN posiłek: owsianka
     * z płatków i mleka nie dobije 52 g białka, choćby idealnie pasowała do śniadania.
     * Dlatego każdego kandydata realnie przepuszczamy przez solver i rozjazd od celu
     * jest głównym składnikiem oceny — reszta rozstrzyga remisy.
     */
    for (const szablon of szablony) {
      if (!szablon.sloty.includes(slot)) continue;
      const dopasowanie = dopasujSzablon(szablon, rozwiazane, uzyteDzis);
      if (!dopasowanie) continue;
      const proba = rozwiazBezOkruchow(dopasowanie.indeksy, cel, pelnyZapas, dopasowanie.rdzen).wynik;
      ocenione.push({
        wybor: { rodzaj: "szablon", dopasowanie },
        ocena:
          -proba.najwiekszeOdchylenie * WAGA_ROZJAZDU +
          dopasowanie.swiezych * WAGA_SWIEZOSCI +
          dopasowanie.wypelnionych -
          (uzyteDania.has(szablon.id) ? KARA_ZA_POWTORKE : 0),
      });
    }

    if (ocenione.length === 0) {
      planSlotow.set(slot, null);
      continue;
    }

    /**
     * KARA_ZA_POWTORKE sama nie wystarcza: BONUS_ZA_PRZEPIS (+12) i premia za świeżość
     * (3 na każdy nieużyty składnik) potrafią ją przebić i wychodził ten sam kurczak na obiad
     * i na kolację. Danie użyte dziś wypada więc z puli **twardo** — ale tylko wtedy, gdy jest
     * z czego wybierać. Przy pustej lodówce lepiej powtórzyć danie niż zostawić slot pusty,
     * i wtedy kara punktowa dalej robi swoje przy porządkowaniu reszty.
     */
    const bezPowtorek = ocenione.filter(({ wybor }) => !uzyteDania.has(idDania(wybor)));
    const najlepszy = losujSposrodNajlepszych(bezPowtorek.length > 0 ? bezPowtorek : ocenione);
    planSlotow.set(slot, najlepszy);

    if (najlepszy.rodzaj === "przepis") {
      uzyteDania.add(najlepszy.przepis.id);
      for (const p of najlepszy.pozycje) uzyteDzis.add(p.indeks);
    } else {
      uzyteDania.add(najlepszy.dopasowanie.szablon.id);
      for (const i of najlepszy.dopasowanie.indeksy) uzyteDzis.add(i);
    }
  }

  const slotyBezDania = zapytanie.sloty.filter((slot) => planSlotow.get(slot) === null);
  if (slotyBezDania.length > 0) {
    ostrzezenia.push(
      `Z tego koszyka nie da się złożyć żadnego dania na: ${slotyBezDania.join(", ")}. ` +
        `Dorzuć coś, co uzupełni danie — np. pieczywo, kaszę albo źródło białka.`
    );
  }

  /**
   * Produkty sklepowe z Open Food Facts nie mogą wypełnić gniazda szablonu, bo nie wiadomo,
   * czym są. Nie wyrzucamy ich jednak z koszyka — user dodał je świadomie — tylko dokładamy
   * jako uzupełnienie, mówiąc wprost, że tego akurat nie potrafimy ocenić.
   *
   * Dotyczy WYŁĄCZNIE produktów z OFF. Kuratorowane składniki bez roli kulinarnej (mąka, woda,
   * drożdże) są półproduktami i mają sens tylko wewnątrz przepisu — dokładane luzem dawały
   * "kanapki z wodą" i "danie na ciepło z mąką".
   */
  // Tylko do slotów z szablonem — do przepisu nie wolno nic dorzucić, bo jego proporcje
  // są częścią przepisu, a nie luźnym zestawem składników.
  const slotyZSzablonem = zapytanie.sloty.filter((slot) => planSlotow.get(slot)?.rodzaj === "szablon");
  const bezRoli = rozwiazane
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.rola === undefined && p.zeSpizarni.zrodlo === "off");
  if (bezRoli.length > 0 && slotyZSzablonem.length > 0) {
    bezRoli.forEach(({ i }, k) => {
      const wybor = planSlotow.get(slotyZSzablonem[k % slotyZSzablonem.length])!;
      if (wybor.rodzaj === "szablon") wybor.dopasowanie.indeksy.push(i);
      uzyteDzis.add(i);
    });
    ostrzezenia.push(
      `Dokładam jako uzupełnienie (nie wiem, do jakiego dania pasują): ` +
        `${bezRoli.map(({ p }) => nazwaWyswietlana(p.zeSpizarni)).join(", ")}.`
    );
  }

  // Niewykorzystany olej z domowej półki to nie jest informacja dla usera — nie prosił o niego.
  const nieuzyte = rozwiazane.map((_, i) => i).filter((i) => !uzyteDzis.has(i) && !rozwiazane[i].zDomu);
  if (nieuzyte.length > 0) {
    ostrzezenia.push(
      `Nie weszły do dzisiejszego planu: ${nieuzyte.map((i) => nazwaWyswietlana(rozwiazane[i].zeSpizarni)).join(", ")} ` +
        `— nie pasowały do żadnego dania, które dało się złożyć z reszty koszyka.`
    );
  }

  const posilki: PosilekWPlanie[] = [];
  /**
   * Ile GRAMÓW każdego składnika zjadły już posiłki rozpisane wcześniej w tej pętli.
   *
   * Jednostka jest tu istotna: ścieżka przepisów zawsze liczyła w gramach, a ścieżka szablonów
   * dorzucała surową ilość w jednostce koszyka. Przy jajkach ("szt") do tego samego licznika
   * wpadały więc raz gramy, raz sztuki — zapas wychodził większy, niż jest (8 jajek z 6),
   * a przy odejmowaniu od resztek odwrotnie: składnik znikał z listy, choć jeszcze go zostało.
   */
  const zuzycie = new Map<number, number>();

  /** Ile gramów tego składnika user jeszcze ma — zapas minus to, co poszło na wcześniejsze posiłki. */
  const zostaloGramow = (i: number): number | undefined => {
    const { wejscie, zeSpizarni } = rozwiazane[i];
    if (wejscie.dostepneIlosc === undefined) return undefined;
    const zapas = masaWGramach(zeSpizarni, wejscie.dostepneIlosc, wejscie.jednostka);
    return Math.max(0, zapas - (zuzycie.get(i) ?? 0));
  };

  /** Ile jeszcze nierozpisanych slotów (licząc bieżący) sięga po ten składnik. */
  const pozostaleSloty = (i: number, odSlotu: number): number =>
    zapytanie.sloty.slice(odSlotu).filter((slot) => {
      const wybor = planSlotow.get(slot);
      return wybor ? indeksyWyboru(wybor).includes(i) : false;
    }).length;

  /**
   * Ile tego składnika wolno zużyć w bieżącym posiłku, w jednostce koszyka.
   *
   * Poprzednia wersja dzieliła **cały** zapas przez liczbę slotów, które go używają, i robiła
   * to tylko dla szablonów — przepisy skalowały się do pełnego zapasu niezależnie od siebie.
   * Skutek: przy 400 g piersi w lodówce wychodził obiad na 400 g i kolacja na 210 g, a kurczak
   * po cichu znikał z listy resztek. Teraz dzielimy to, co **zostało**, i dotyczy to obu ścieżek,
   * więc suma dnia nigdy nie przekracza zawartości lodówki.
   */
  const udzialNaPosilek = (i: number, odSlotu: number): number | undefined => {
    const zostalo = zostaloGramow(i);
    if (zostalo === undefined) return undefined;
    const naPosilek = zostalo / Math.max(1, pozostaleSloty(i, odSlotu));
    const { wejscie, zeSpizarni } = rozwiazane[i];
    return wejscie.jednostka === "szt" && zeSpizarni.masaSztuki
      ? naPosilek / zeSpizarni.masaSztuki
      : naPosilek;
  };

  for (let numerSlotu = 0; numerSlotu < zapytanie.sloty.length; numerSlotu++) {
    const slot = zapytanie.sloty[numerSlotu];
    const wybor = planSlotow.get(slot);
    if (!wybor) continue;

    // --- Przepis: skalujemy proporcjonalnie i przepisujemy instrukcje z bazy ---------------
    if (wybor.rodzaj === "przepis") {
      // Współczynnik z fazy oceniania zakładał pełny zapas — tutaj przycinamy go tym, co
      // faktycznie zostało po wcześniejszych posiłkach, i przeliczamy makro oraz rozjazd.
      let wspolczynnik = wybor.wspolczynnik;
      for (const pozycja of wybor.pozycje) {
        const limit = udzialNaPosilek(pozycja.indeks, numerSlotu);
        if (limit === undefined) continue;
        const { wejscie, zeSpizarni } = rozwiazane[pozycja.indeks];
        const mozeGramow = masaWGramach(zeSpizarni, limit, wejscie.jednostka);
        const trzebaGramow = masaWGramach(zeSpizarni, pozycja.ilosc, pozycja.jednostka);
        if (trzebaGramow > 0) wspolczynnik = Math.min(wspolczynnik, mozeGramow / trzebaGramow);
      }

      const makroPrzepisu = skalujMakro(makroPozycjiPrzepisu(wybor.pozycje), wspolczynnik);
      const cel = celeSlotow[slot];
      const odchylenie = Math.max(
        ...(["kcal", "bialko", "tluszcz", "wegle"] as const).map((c) =>
          cel[c] > 0 ? Math.abs(((makroPrzepisu[c] - cel[c]) / cel[c]) * 100) : 0
        )
      );

      if (odchylenie > PROG_OSTRZEZENIA_PRZEPISU) {
        ostrzezenia.push(
          `${slot} (${wybor.przepis.nazwa.toLowerCase()}): ${opiszRozjazd({
            kcal: ((makroPrzepisu.kcal - cel.kcal) / cel.kcal) * 100,
            bialko: ((makroPrzepisu.bialko - cel.bialko) / cel.bialko) * 100,
            tluszcz: ((makroPrzepisu.tluszcz - cel.tluszcz) / cel.tluszcz) * 100,
            wegle: ((makroPrzepisu.wegle - cel.wegle) / cel.wegle) * 100,
          })} — to normalne przy gotowaniu z przepisu, bo skalujemy go w całości.`
        );
      }

      const skladnikiPrzepisu: SkladnikWPlanie[] = wybor.pozycje.map((pozycja) => {
        const { wejscie, zeSpizarni } = rozwiazane[pozycja.indeks];
        let ilosc = zaokraglijKuchennie(pozycja.ilosc * wspolczynnik, pozycja.jednostka);

        const limit = udzialNaPosilek(pozycja.indeks, numerSlotu);
        if (limit !== undefined) {
          // Limit jest w jednostce koszyka, ilość w jednostce przepisu — spotykają się w gramach.
          const maksGramow = masaWGramach(zeSpizarni, limit, wejscie.jednostka);
          const gramNaJednostke = masaWGramach(zeSpizarni, 1, pozycja.jednostka);
          if (gramNaJednostke > 0) {
            ilosc = Math.min(ilosc, zaokraglijWDol(maksGramow / gramNaJednostke, pozycja.jednostka));
          }
        }
        zuzycie.set(
          pozycja.indeks,
          (zuzycie.get(pozycja.indeks) ?? 0) + masaWGramach(zeSpizarni, ilosc, pozycja.jednostka)
        );
        return { skladnikId: pozycja.skladnikId, nazwa: zeSpizarni.nazwa, ilosc, jednostka: pozycja.jednostka };
      });

      posilki.push({
        slot,
        recipeId: wybor.przepis.id,
        nazwa: wybor.przepis.nazwa,
        charakter: wybor.przepis.charakter,
        czasPrzygotowania: wybor.przepis.czasPrzygotowania,
        czasOczekiwania: wybor.przepis.czasOczekiwania,
        uwaga: wybor.przepis.czasOczekiwania
          ? `Przygotuj wcześniej — wymaga ${wybor.przepis.czasOczekiwania} oczekiwania.`
          : undefined,
        skladniki: skladnikiPrzepisu,
        skladnikiBazowe: skladnikiPrzepisu.map((s) => ({ ...s })),
        instrukcje: wybor.przepis.instrukcje,
        makro: makroPrzepisu,
      });
      continue;
    }

    // --- Szablon: solver dobiera gramatury, instrukcji nie ma ------------------------------
    const { wynik, indeksy: uzyteIndeksy } = rozwiazBezOkruchow(
      wybor.dopasowanie.indeksy,
      celeSlotow[slot],
      (i) => udzialNaPosilek(i, numerSlotu),
      wybor.dopasowanie.rdzen
    );

    if (wynik.najwiekszeOdchylenie > PROG_OSTRZEZENIA_PROCENT) {
      ostrzezenia.push(
        `${slot} (${wybor.dopasowanie.szablon.nazwa.toLowerCase()}): ${opiszRozjazd(wynik.odchylenia)}. ` +
          `Dorzuć do koszyka coś, co to nadrobi.`
      );
    }

    const skladniki: SkladnikWPlanie[] = [];
    const skladnikiBazowe: SkladnikBazowyWPlanie[] = [];
    let makro = pustaMakro();

    for (let k = 0; k < wynik.pozycje.length; k++) {
      const dobrana = wynik.pozycje[k];
      if (dobrana.ilosc <= 0) continue;
      const indeks = uzyteIndeksy[k];
      const { wejscie, zeSpizarni } = rozwiazane[indeks];

      zuzycie.set(indeks, (zuzycie.get(indeks) ?? 0) + masaWGramach(zeSpizarni, dobrana.ilosc, wejscie.jednostka));
      makro = dodajMakro(makro, dobrana.makro);

      const wpis = {
        skladnikId: wejscie.id,
        nazwa: nazwaWyswietlana(zeSpizarni),
        ilosc: dobrana.ilosc,
        jednostka: wejscie.jednostka,
      };
      skladniki.push(wpis);
      skladnikiBazowe.push({ ...wpis });
    }

    if (skladniki.length === 0) {
      ostrzezenia.push(`Slot "${slot}": solver wyzerował wszystkie składniki — cel jest za mały na ten zestaw.`);
      continue;
    }

    posilki.push({
      slot,
      recipeId: `szablon:${wybor.dopasowanie.szablon.id}`,
      nazwa: wybor.dopasowanie.szablon.nazwa,
      skladniki,
      skladnikiBazowe,
      instrukcje: [],
      makro,
      wlasny: true,
    });
  }

  const resztki: ResztkaWLodowce[] = [];
  for (let i = 0; i < rozwiazane.length; i++) {
    const { wejscie, zeSpizarni } = rozwiazane[i];
    if (wejscie.dostepneIlosc === undefined) continue;
    // `zuzycie` jest w gramach, `dostepneIlosc` w jednostce koszyka — odejmujemy w gramach
    // i wracamy na jednostkę, w której user to wpisał.
    const zapasGramow = masaWGramach(zeSpizarni, wejscie.dostepneIlosc, wejscie.jednostka);
    const zostaloGramow = zapasGramow - (zuzycie.get(i) ?? 0);
    if (zostaloGramow <= 0) continue;
    const zostalo =
      wejscie.jednostka === "szt" && zeSpizarni.masaSztuki
        ? zostaloGramow / zeSpizarni.masaSztuki
        : zostaloGramow;
    resztki.push({
      id: wejscie.id,
      nazwa: nazwaWyswietlana(zeSpizarni),
      zostalo: Math.round(zostalo * 10) / 10,
      jednostka: wejscie.jednostka,
    });
  }

  const makroDnia = posilki.reduce((suma, p) => dodajMakro(suma, p.makro), pustaMakro());

  const propozycje = zaproponujDokupienie({
    koszyk: zapytanie.koszyk.map((p) => p.id),
    sloty: zapytanie.sloty,
    restrykcje,
  });

  return { kcalDzienne, makroDzienne, celeSlotow, posilki, makroDnia, resztki, propozycje, ostrzezenia };
}

/**
 * Ręczna korekta gotowego posiłku: user wpisuje gramaturę, na której mu zależy
 * ("chcę 200 g piersi"), a solver przelicza resztę składników tak, żeby posiłek
 * dalej trafiał w cel makro slotu.
 *
 * To ten sam mechanizm, co "stała pozycja" w kreatorze — różnica jest taka, że tutaj
 * obowiązują sufity kulinarne z tego modułu (`granicePozycji`), więc dosypanie oliwy
 * dla samych kcal dalej jest niemożliwe.
 *
 * Skład posiłku się NIE zmienia: nie dobieramy nowego szablonu ani nowych składników,
 * bo user poprawia konkretne danie, które ma przed oczami.
 */
export interface PozycjaDoKorekty {
  id: string;
  jednostka: JednostkaKoszyka;
  ilosc: number;
  /** User wpisał tę gramaturę ręcznie — solver jej nie rusza. */
  stala?: boolean;
}

export interface WynikKorekty {
  skladniki: SkladnikWPlanie[];
  makro: Makro;
  ostrzezenia: string[];
}

export function przeliczPosilek(pozycje: PozycjaDoKorekty[], cel: Makro): WynikKorekty {
  if (pozycje.length === 0) throw new Error("Posiłek musi mieć co najmniej jeden składnik");

  const skladnikiBazy = mapaSkladnikow();
  const przygotowane = pozycje.map((pozycja) => {
    const zeSpizarni = pobierzPozycjeSpizarni(pozycja.id);
    if (pozycja.ilosc < 0) throw new Error(`Ujemna ilość dla "${zeSpizarni.nazwa}"`);
    if (pozycja.jednostka === "szt" && !zeSpizarni.masaSztuki) {
      throw new Error(`"${zeSpizarni.nazwa}" nie ma zdefiniowanej masy sztuki — podaj ilość w gramach`);
    }
    const zBazy = skladnikiBazy.get(pozycja.id);
    return {
      pozycja,
      zeSpizarni,
      rola: zBazy?.rolaKulinarna,
      porcjaTypowa: zBazy?.porcjaTypowa,
      maksPorcja: zBazy?.maksPorcja,
    };
  });

  const doDobrania: PozycjaDoDobrania[] = przygotowane.map(
    ({ pozycja, zeSpizarni, rola, porcjaTypowa, maksPorcja }) => {
      const granice = granicePozycji({
        rola,
        jednostka: pozycja.jednostka,
        celSlotu: cel,
        // Pozycje nieprzypięte dostają minimum sensownej porcji, żeby po korekcie jednej gramatury
        // reszta składników nie schodziła do zera i danie nie znikało userowi z listy.
        wRdzeniu: !pozycja.stala,
        sufitSkladnika: naJednostkeKoszyka(maksPorcja, pozycja.jednostka, zeSpizarni.masaSztuki),
        porcjaTypowa: naJednostkeKoszyka(porcjaTypowa, pozycja.jednostka, zeSpizarni.masaSztuki),
      });
      return {
        id: pozycja.id,
        makroNaJednostke: makroNaJednostke(zeSpizarni, pozycja.jednostka),
        ilosc: pozycja.ilosc,
        stala: pozycja.stala,
        min: granice.min,
        max: pozycja.stala ? Math.max(granice.max, pozycja.ilosc) : granice.max,
        krok: granice.krok,
        // Pozycja przypięta przez usera nie ma być ciągnięta ku niczemu — solver jej nie rusza.
        preferowana: pozycja.stala ? undefined : granice.preferowana,
      };
    }
  );

  const wynik = dobierzIlosci(doDobrania, cel);
  const ostrzezenia: string[] = [];
  if (wynik.najwiekszeOdchylenie > PROG_OSTRZEZENIA_PROCENT) {
    ostrzezenia.push(
      `Przy tych gramaturach ${opiszRozjazd(wynik.odchylenia)} — odepnij coś albo zmień wpisaną ilość.`
    );
  }

  const skladniki: SkladnikWPlanie[] = [];
  let makro = pustaMakro();
  for (let i = 0; i < wynik.pozycje.length; i++) {
    const dobrana = wynik.pozycje[i];
    const { pozycja, zeSpizarni } = przygotowane[i];
    if (dobrana.ilosc <= 0 && !pozycja.stala) continue;
    makro = dodajMakro(makro, dobrana.makro);
    skladniki.push({
      skladnikId: pozycja.id,
      nazwa: nazwaWyswietlana(zeSpizarni),
      ilosc: dobrana.ilosc,
      jednostka: pozycja.jednostka,
    });
  }

  return { skladniki, makro, ostrzezenia };
}
