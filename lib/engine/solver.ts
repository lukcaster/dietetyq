import type { Makro } from "./types";

/**
 * Dobór gramatur pod docelowe makro.
 *
 * Problem: mamy zestaw składników (każdy o znanym makro na jednostkę) i cel
 * (kcal + białko/tłuszcz/węgle). Szukamy ilości, przy których suma jest jak najbliżej celu.
 * To zwykły ważony najmniejszy kwadrat z ograniczeniami pudełkowymi (min/max na każdy składnik),
 * czyli problem wypukły — rozwiązujemy go coordinate descentem: w kółko liczymy optymalną ilość
 * jednego składnika przy pozostałych zamrożonych. Dla funkcji wypukłej z ograniczeniami
 * pudełkowymi to zbiega do minimum globalnego, a przy okazji jest trywialne do debugowania.
 *
 * Świadomie NIE używamy tu żadnej biblioteki optymalizacyjnej — problem ma rozmiar rzędu
 * 10 zmiennych i 4 równań, a silnik ma zostać zależnościowo czysty (patrz SPEC: moduł
 * niezależny od Next.js, do przeniesienia na mobilkę).
 */

const CELE = ["kcal", "bialko", "tluszcz", "wegle"] as const;
type Cel = (typeof CELE)[number];

export type Odchylenia = Record<Cel, number>;

/**
 * Ile waży trafienie w dany cel. kcal jest najważniejsze (user zwykle o nie pyta),
 * białko drugie (najczęściej niedobierane), tłuszcz i węgle to reszta bilansu.
 */
export const DOMYSLNE_WAGI: Record<Cel, number> = { kcal: 3, bialko: 2, tluszcz: 1, wegle: 1 };

export interface PozycjaDoDobrania {
  /** Identyfikator wołającego — solver go tylko przepisuje na wyjście. */
  id: string;
  /** Makro jednej jednostki: dla gramów to makroNa100g/100, dla sztuk makroNa100g*masaSztuki/100. */
  makroNaJednostke: Makro;
  /** Ilość startowa (a dla pozycji stałej — ilość ostateczna). */
  ilosc: number;
  /** Stała pozycja nie jest ruszana: "150 g piersi ma zostać 150 g". */
  stala?: boolean;
  min?: number;
  max?: number;
  /** Do ilokrotności zaokrąglić wynik (5 g, 1 sztuka). Domyślnie 1. */
  krok?: number;
  /**
   * Typowa porcja tego składnika — ilość, którą normalny człowiek nakłada sobie na talerz.
   * Brak = solverowi wszystko jedno, liczy się wyłącznie makro (tak działał przed zmianą).
   * Patrz WAGA_TYPOWEJ_PORCJI.
   */
  preferowana?: number;
}

export interface PozycjaDobrana {
  id: string;
  ilosc: number;
  makro: Makro;
  /** Ustawione, gdy pozycja oparła się o swoje ograniczenie — czyli cel ciągnął ją dalej. */
  przyLimicie: "min" | "max" | null;
}

export interface WynikSolvera {
  pozycje: PozycjaDobrana[];
  makro: Makro;
  cel: Makro;
  /** Odchylenie od celu w procentach, ze znakiem (dodatnie = jest za dużo). */
  odchylenia: Odchylenia;
  /** Największe odchylenie bezwzględne spośród wszystkich celów — do progów w UI. */
  najwiekszeOdchylenie: number;
  iteracje: number;
}

/**
 * Jak mocno ciągniemy pozycję ku jej typowej porcji (`porcjaTypowa` w ingredients.json).
 *
 * Bez tego członu funkcja celu jest **płaska** w kierunku składników, które prawie nie ruszają
 * makro — 100 g ogórka to 12 kcal i zero białka. Solverowi jest wtedy wszystko jedno, więc
 * ląduje na losowym krańcu przedziału i wychodzi "200 g ogórka" albo "15 g borówek" przy
 * 250 g w koszyku. Matematycznie bez zarzutu, na talerzu absurd.
 *
 * Człon jest znormalizowany tak samo jak wagi makro (dzielimy przez kwadrat wielkości), więc
 * mówi o **względnym** odchyleniu od porcji, nie o gramach.
 *
 * Wartość dobrana pomiarem na 150 losowych dniach trybu "z lodówki" — kolumna "porcje ponad
 * dwukrotność typowej" kontra średni rozjazd od celu:
 *
 *   waga  | absurdalne porcje | rozjazd kcal | rozjazd białka
 *   0     |       13,4 %      |    27,0 %    |    43,8 %
 *   0,08  |       10,3 %      |    29,4 %    |    47,8 %
 *   0,2   |        7,2 %      |    30,4 %    |    48,5 %
 *   0,4   |        5,8 %      |    32,6 %    |    51,8 %
 *
 * Stoi na 0,2: połowa absurdalnych porcji mniej niż przy zerze, kosztem ~3 pkt proc. rozjazdu.
 * To ta sama zasada, co przy WAGA_ROZJAZDU w z-lodowki.ts — lepiej zjeść sensowną porcję
 * i mieć dzień z gorszym białkiem, niż dostać idealnie policzone 200 g ogórka w kanapce.
 */
const WAGA_TYPOWEJ_PORCJI = 0.2;

const MAX_ITERACJI = 500;
const PROG_ZBIEZNOSCI = 1e-4;

function pustyWektor(): Makro {
  return { kcal: 0, bialko: 0, tluszcz: 0, wegle: 0 };
}

function ogranicz(wartosc: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, wartosc));
}

interface Granice {
  min: number;
  max: number;
  krok: number;
}

/**
 * Bez górnego limitu solver potrafi wsypać 800 g oliwy, żeby dobić kcal. Domyślny sufit
 * to czterokrotność ilości startowej — wołający (kreator) i tak zwykle poda własne.
 */
function granice(pozycja: PozycjaDoDobrania): Granice {
  const min = pozycja.min ?? 0;
  const max = pozycja.max ?? Math.max(pozycja.ilosc * 4, 100);
  return { min, max: Math.max(min, max), krok: pozycja.krok && pozycja.krok > 0 ? pozycja.krok : 1 };
}

function sumaMakro(pozycje: PozycjaDoDobrania[], ilosci: number[]): Makro {
  const suma = pustyWektor();
  for (let i = 0; i < pozycje.length; i++) {
    for (const cel of CELE) suma[cel] += pozycje[i].makroNaJednostke[cel] * ilosci[i];
  }
  return suma;
}

/** Suma ważonych kwadratów względnych błędów — to jest to, co minimalizujemy. */
function funkcjaCelu(suma: Makro, cel: Makro, q: Record<Cel, number>): number {
  let wynik = 0;
  for (const c of CELE) wynik += q[c] * (suma[c] - cel[c]) ** 2;
  return wynik;
}

/**
 * Waga ciążenia ku typowej porcji, osobno dla każdej pozycji. Zero = pozycja bez podanej
 * porcji typowej, czyli zachowanie sprzed wprowadzenia tego członu.
 */
function wagiPorcji(pozycje: PozycjaDoDobrania[]): number[] {
  return pozycje.map((pozycja) =>
    pozycja.preferowana !== undefined && pozycja.preferowana > 0
      ? WAGA_TYPOWEJ_PORCJI / pozycja.preferowana ** 2
      : 0
  );
}

/** Kara za odejście od typowych porcji — druga połowa funkcji celu. */
function karaZaPorcje(pozycje: PozycjaDoDobrania[], ilosci: number[], lambdy: number[]): number {
  let wynik = 0;
  for (let i = 0; i < pozycje.length; i++) {
    if (lambdy[i] === 0) continue;
    wynik += lambdy[i] * (ilosci[i] - pozycje[i].preferowana!) ** 2;
  }
  return wynik;
}

/** Waga celu przeskalowana przez jego wielkość, żeby 2000 kcal i 120 g białka ważyły porównywalnie. */
function wagiZnormalizowane(cel: Makro, wagi: Record<Cel, number>): Record<Cel, number> {
  const q = {} as Record<Cel, number>;
  for (const c of CELE) q[c] = cel[c] > 0 ? wagi[c] / cel[c] ** 2 : 0;
  return q;
}

export function dobierzIlosci(
  pozycje: PozycjaDoDobrania[],
  cel: Makro,
  wagi: Record<Cel, number> = DOMYSLNE_WAGI
): WynikSolvera {
  const q = wagiZnormalizowane(cel, wagi);
  const lambdy = wagiPorcji(pozycje);
  const wszystkieGranice = pozycje.map(granice);
  const elastyczne = pozycje.map((p, i) => (p.stala ? -1 : i)).filter((i) => i >= 0);

  const ilosci = pozycje.map((p, i) =>
    p.stala ? p.ilosc : ogranicz(p.ilosc, wszystkieGranice[i].min, wszystkieGranice[i].max)
  );

  let iteracje = 0;
  for (; iteracje < MAX_ITERACJI && elastyczne.length > 0; iteracje++) {
    let najwiekszaZmiana = 0;

    for (const j of elastyczne) {
      const a = pozycje[j].makroNaJednostke;

      // Reszta = ile brakuje/zostaje bez wkładu pozycji j. Minimum kwadratowej funkcji
      // jednej zmiennej wypada w -(suma q*a*reszta) / (suma q*a^2).
      let licznik = 0;
      let mianownik = 0;
      for (const c of CELE) {
        if (q[c] === 0 || a[c] === 0) continue;
        let bezJ = -cel[c];
        for (let k = 0; k < pozycje.length; k++) {
          if (k !== j) bezJ += pozycje[k].makroNaJednostke[c] * ilosci[k];
        }
        licznik += q[c] * a[c] * bezJ;
        mianownik += q[c] * a[c] * a[c];
      }
      // Człon porcji dokłada się do tej samej paraboli: d/dx [lambda*(x-p)^2] = 2*lambda*(x-p),
      // więc minimum przesuwa się o lambda*p w liczniku i lambda w mianowniku. Zamknięta postać
      // zostaje, coordinate descent dalej zbiega do minimum globalnego (funkcja nadal wypukła).
      const lambda = lambdy[j];
      if (mianownik + lambda === 0) continue;

      const { min, max } = wszystkieGranice[j];
      const preferowana = pozycje[j].preferowana ?? 0;
      const nowa = ogranicz((-licznik + lambda * preferowana) / (mianownik + lambda), min, max);
      najwiekszaZmiana = Math.max(najwiekszaZmiana, Math.abs(nowa - ilosci[j]));
      ilosci[j] = nowa;
    }

    if (najwiekszaZmiana < PROG_ZBIEZNOSCI) break;
  }

  zaokraglijIDoszlifuj(pozycje, ilosci, elastyczne, wszystkieGranice, cel, q, lambdy);

  const makro = sumaMakro(pozycje, ilosci);
  const odchylenia = {} as Odchylenia;
  for (const c of CELE) odchylenia[c] = cel[c] > 0 ? ((makro[c] - cel[c]) / cel[c]) * 100 : 0;

  const wynikowePozycje: PozycjaDobrana[] = pozycje.map((p, i) => {
    const g = wszystkieGranice[i];
    const przyLimicie = p.stala
      ? null
      : Math.abs(ilosci[i] - g.min) < 1e-6
        ? "min"
        : Math.abs(ilosci[i] - g.max) < 1e-6
          ? "max"
          : null;
    const makroPozycji = pustyWektor();
    for (const c of CELE) makroPozycji[c] = p.makroNaJednostke[c] * ilosci[i];
    return { id: p.id, ilosc: ilosci[i], makro: makroPozycji, przyLimicie };
  });

  return {
    pozycje: wynikowePozycje,
    makro,
    cel,
    odchylenia,
    najwiekszeOdchylenie: Math.max(...CELE.map((c) => Math.abs(odchylenia[c]))),
    iteracje,
  };
}

/**
 * Nikt nie odważy 137,4 g ryżu, więc zaokrąglamy do kroku — ale samo zaokrąglenie
 * potrafi zepsuć dopasowanie. Po nim robimy kilka przebiegów "spróbuj o krok w górę/w dół",
 * przyjmując zmianę tylko wtedy, gdy realnie zbliża do celu.
 */
function zaokraglijIDoszlifuj(
  pozycje: PozycjaDoDobrania[],
  ilosci: number[],
  elastyczne: number[],
  wszystkieGranice: Granice[],
  cel: Makro,
  q: Record<Cel, number>,
  lambdy: number[]
): void {
  for (const j of elastyczne) {
    const { min, max, krok } = wszystkieGranice[j];
    ilosci[j] = ogranicz(Math.round(ilosci[j] / krok) * krok, min, max);
  }

  for (let przebieg = 0; przebieg < 3; przebieg++) {
    let poprawiono = false;

    for (const j of elastyczne) {
      const { min, max, krok } = wszystkieGranice[j];
      let najlepszaWartosc = ilosci[j];
      let najlepszyWynik =
        funkcjaCelu(sumaMakro(pozycje, ilosci), cel, q) + karaZaPorcje(pozycje, ilosci, lambdy);

      for (const kandydat of [ilosci[j] - krok, ilosci[j] + krok]) {
        if (kandydat < min || kandydat > max) continue;
        const poprzednia = ilosci[j];
        ilosci[j] = kandydat;
        const wynik = funkcjaCelu(sumaMakro(pozycje, ilosci), cel, q) + karaZaPorcje(pozycje, ilosci, lambdy);
        ilosci[j] = poprzednia;
        if (wynik < najlepszyWynik - 1e-12) {
          najlepszyWynik = wynik;
          najlepszaWartosc = kandydat;
        }
      }

      if (najlepszaWartosc !== ilosci[j]) {
        ilosci[j] = najlepszaWartosc;
        poprawiono = true;
      }
    }

    if (!poprawiono) break;
  }
}
