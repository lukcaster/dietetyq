/**
 * Sprawdzarka kuratorowanej bazy: data/ingredients.json, data/recipes.json, data/components.json.
 *
 * Powstała, bo baza urosła na tyle, że przy dopisywaniu przepisu łatwo trafić w coś, co już jest,
 * albo odwołać się do składnika, którego nie ma. Silnik takiego błędu nie wybaczy dopiero
 * w runtime (`getIngredientById` rzuca wyjątkiem), a to jest za późno.
 *
 *   node scripts/sprawdz-baze.mjs                  # pełny raport
 *   node scripts/sprawdz-baze.mjs --strict         # ostrzeżenia też kończą błędem (do CI)
 *   node scripts/sprawdz-baze.mjs --prog=0.5       # czulsze wykrywanie duplikatów (domyślnie 0.6)
 *   node scripts/sprawdz-baze.mjs --przepis=sernik # makro jednego przepisu, składnik po składniku
 *
 * Świadomie NIE importuje silnika z lib/engine: tamten kod jest w TypeScripcie i zakłada
 * kontekst Next.js, a ta sprawdzarka ma się dać odpalić gołym `node` w dowolnym momencie.
 * Powielona jest tylko arytmetyka makro — kilkanaście linii, których i tak pilnuje test niżej
 * (porównanie zsumowanych kcal z 4/9/4 na B/T/W).
 */

import fs from "fs";
import path from "path";

const DATA = path.join(process.cwd(), "data");
const wczytaj = (plik) => JSON.parse(fs.readFileSync(path.join(DATA, plik), "utf8"));

const flagi = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [klucz, wartosc] = a.replace(/^--/, "").split("=");
    return [klucz, wartosc ?? true];
  })
);

const PROG_PODOBIENSTWA = Number(flagi.prog ?? 0.6);
/** Powyżej tego rozjazdu suma kcal nie zgadza się z 4/9/4 na B/T/W — zwykle literówka w makro. */
const PROG_ROZJAZDU_KCAL = 0.12;

/**
 * Składniki, dla których suma 4/9/4 z założenia nie wyjdzie — i to nie jest błąd w danych:
 * - kakao: same tabele odżywcze (USDA włącznie) podają tu kcal niższe, niż wychodzi z makro,
 *   bo tłuszcz kakaowy i skrobia w ziarnie nie są w pełni przyswajalne,
 * - proszek do pieczenia: to, co jest zapisane jako węglowodany, to sole mineralne
 *   (wodorowęglan, fosforany), których organizm nie spala,
 * - ocet ryżowy: jego kalorie pochodzą z kwasu octowego, a ten nie jest ani białkiem,
 *   ani tłuszczem, ani węglowodanem — w makro nie ma go gdzie zapisać.
 */
const BEZ_KONTROLI_KCAL = new Set(["kakao", "proszek-do-pieczenia", "ocet-ryzowy"]);

const SLOTY = ["sniadanie", "drugie-sniadanie", "obiad", "podwieczorek", "kolacja"];
const KATEGORIE_DANIA = ["glowne", "dodatek-skrobiowy", "surowka"];

const skladniki = wczytaj("ingredients.json");
const przepisy = wczytaj("recipes.json");
const komponenty = wczytaj("components.json");

const poId = new Map(skladniki.map((s) => [s.id, s]));
const komponentPoId = new Map(komponenty.map((k) => [k.id, k]));

const bledy = [];
const ostrzezenia = [];
const blad = (gdzie, tekst) => bledy.push(`${gdzie}: ${tekst}`);
const ostrzez = (gdzie, tekst) => ostrzezenia.push(`${gdzie}: ${tekst}`);

// ---------------------------------------------------------------------------------------
// Arytmetyka
// ---------------------------------------------------------------------------------------
const CELE = ["kcal", "bialko", "tluszcz", "wegle"];
const pusteMakro = () => ({ kcal: 0, bialko: 0, tluszcz: 0, wegle: 0 });

/** "szt" przelicza przez masaSztuki; "ml" traktujemy jak gramy — tak samo robi silnik. */
function gramy(skladnik, ilosc, jednostka, gdzie) {
  if (jednostka !== "szt") return ilosc;
  if (!skladnik.masaSztuki) {
    blad(gdzie, `"${skladnik.id}" użyty w sztukach, ale nie ma masaSztuki`);
    return 0;
  }
  return ilosc * skladnik.masaSztuki;
}

function dodaj(suma, skladnik, g) {
  for (const c of CELE) suma[c] += (skladnik.makroNa100g[c] * g) / 100;
  return suma;
}

const jestGrupa = (pozycja) => "kategoria" in pozycja;
const jestKomponent = (pozycja) => "komponentId" in pozycja;

/**
 * Rozkłada pozycję przepisu na realne składniki bazowe.
 * Zwraca [{ skladnik, gramy, token }], gdzie `token` jest tożsamością pozycji przy
 * porównywaniu przepisów: dla grupy wyboru to KATEGORIA, nie domyślny składnik — dwa przepisy
 * "na dowolnej mące" pokrywają się ze sobą niezależnie od tego, co mają ustawione domyślnie.
 */
function rozloz(pozycja, gdzie) {
  if (jestGrupa(pozycja)) {
    const pula = skladniki.filter((s) => s.kategoria === pozycja.kategoria);
    if (pula.length === 0) {
      blad(gdzie, `kategoria "${pozycja.kategoria}" nie ma ani jednego składnika`);
      return [];
    }
    const domyslny = poId.get(pozycja.domyslnaSkladnikId);
    if (!domyslny) {
      blad(gdzie, `nieznany domyslnaSkladnikId "${pozycja.domyslnaSkladnikId}"`);
      return [];
    }
    if (domyslny.kategoria !== pozycja.kategoria) {
      blad(gdzie, `domyślny "${domyslny.id}" nie należy do kategorii "${pozycja.kategoria}"`);
    }
    return [
      {
        skladnik: domyslny,
        gramy: gramy(domyslny, pozycja.ilosc, pozycja.jednostka, gdzie),
        token: `grupa:${pozycja.kategoria}`,
      },
    ];
  }

  if (jestKomponent(pozycja)) {
    const komponent = komponentPoId.get(pozycja.komponentId);
    if (!komponent) {
      blad(gdzie, `nieznany komponent "${pozycja.komponentId}"`);
      return [];
    }
    const proporcja = pozycja.ilosc / komponent.iloscWynikowa;
    return komponent.skladniki.flatMap((s) => {
      const skladnik = poId.get(s.skladnikId);
      if (!skladnik) {
        blad(`komponent ${komponent.id}`, `nieznany składnik "${s.skladnikId}"`);
        return [];
      }
      return [
        {
          skladnik,
          gramy: gramy(skladnik, s.ilosc, s.jednostka, gdzie) * proporcja,
          token: s.skladnikId,
        },
      ];
    });
  }

  const skladnik = poId.get(pozycja.skladnikId);
  if (!skladnik) {
    blad(gdzie, `nieznany składnik "${pozycja.skladnikId}"`);
    return [];
  }
  return [{ skladnik, gramy: gramy(skladnik, pozycja.ilosc, pozycja.jednostka, gdzie), token: pozycja.skladnikId }];
}

// ---------------------------------------------------------------------------------------
// Składniki — spójność wpisów
// ---------------------------------------------------------------------------------------
const widzianeIdSkladnikow = new Set();
for (const s of skladniki) {
  const gdzie = `składnik ${s.id}`;
  if (widzianeIdSkladnikow.has(s.id)) blad(gdzie, "zduplikowane id");
  widzianeIdSkladnikow.add(s.id);

  if (!s.makroNa100g) blad(gdzie, "brak makroNa100g");
  else {
    for (const c of CELE) {
      if (typeof s.makroNa100g[c] !== "number") blad(gdzie, `makroNa100g.${c} nie jest liczbą`);
    }
    // W `wegle` siedzą węglowodany OGÓŁEM, razem z błonnikiem — a błonnik daje ok. 2 kcal/g,
    // nie 4 (tak liczy też rozporządzenie UE 1169/2011). Bez tej poprawki każde warzywo
    // liściaste i każda przyprawa wyglądały na błąd w danych.
    const blonnik = Math.min(s.mikroNa100g?.blonnik ?? 0, s.makroNa100g.wegle);
    const zBTW =
      s.makroNa100g.bialko * 4 + s.makroNa100g.tluszcz * 9 + (s.makroNa100g.wegle - blonnik) * 4 + blonnik * 2;
    const roznica = Math.abs(zBTW - s.makroNa100g.kcal);
    const wyjatek = s.makroNa100g.kcal === 0 || BEZ_KONTROLI_KCAL.has(s.id);
    // Próg bezwzględny obok procentowego: przy ogórku (12 kcal) różnica 4 kcal to 33% i sam
    // szum zaokrągleń z tabel, a przy mące ta sama różnica procentowa to już realna literówka.
    if (!wyjatek && roznica > 15 && roznica / s.makroNa100g.kcal > 0.25) {
      ostrzez(gdzie, `kcal ${s.makroNa100g.kcal} vs ${Math.round(zBTW)} z B/T/W (błonnik po 2 kcal/g) — sprawdź wartości`);
    }
  }

  if (!Array.isArray(s.tagiAlergenow)) blad(gdzie, "tagiAlergenow musi być tablicą");
  if (!s.mikroNa100g) ostrzez(gdzie, "brak mikroNa100g — wypada z bilansu mikroskładników");
  if (s.porcjaTypowa !== undefined && s.maksPorcja !== undefined && s.porcjaTypowa > s.maksPorcja) {
    blad(gdzie, `porcjaTypowa (${s.porcjaTypowa}) większa niż maksPorcja (${s.maksPorcja})`);
  }
  // Składnik z rolą trafia do szablonów dań, więc solver musi wiedzieć, ile go nakładać.
  if (s.rolaKulinarna && s.porcjaTypowa === undefined) {
    ostrzez(gdzie, `ma rolaKulinarna "${s.rolaKulinarna}", ale nie ma porcjaTypowa`);
  }
}

// ---------------------------------------------------------------------------------------
// Przepisy — referencje, makro, sloty
// ---------------------------------------------------------------------------------------
const rozlozone = new Map(); // id przepisu -> { makro, udzialy: Map<token, ulamekMasy>, masa }
const widzianeIdPrzepisow = new Set();
const nazwyPrzepisow = new Map();

for (const p of przepisy) {
  const gdzie = `przepis ${p.id}`;
  if (widzianeIdPrzepisow.has(p.id)) blad(gdzie, "zduplikowane id");
  widzianeIdPrzepisow.add(p.id);

  const klucz = p.nazwa.toLowerCase().trim();
  if (nazwyPrzepisow.has(klucz)) ostrzez(gdzie, `taka sama nazwa jak "${nazwyPrzepisow.get(klucz)}"`);
  nazwyPrzepisow.set(klucz, p.id);

  if (!Number.isFinite(p.porcje) || p.porcje <= 0) blad(gdzie, "porcje musi być liczbą dodatnią");
  if (!Array.isArray(p.slot) || p.slot.length === 0) blad(gdzie, "brak slotów");
  else for (const slot of p.slot) if (!SLOTY.includes(slot)) blad(gdzie, `nieznany slot "${slot}"`);
  if (!["slodkie", "wytrawne"].includes(p.charakter)) blad(gdzie, `nieznany charakter "${p.charakter}"`);
  if (p.kategoriaDania && !KATEGORIE_DANIA.includes(p.kategoriaDania)) {
    blad(gdzie, `nieznana kategoriaDania "${p.kategoriaDania}"`);
  }
  if (!Array.isArray(p.instrukcje) || p.instrukcje.length === 0) ostrzez(gdzie, "brak instrukcji");

  let makro = pusteMakro();
  let masa = 0;
  const udzialy = new Map();

  for (const pozycja of p.skladniki ?? []) {
    for (const { skladnik, gramy: g, token } of rozloz(pozycja, gdzie)) {
      makro = dodaj(makro, skladnik, g);
      masa += g;
      udzialy.set(token, (udzialy.get(token) ?? 0) + g);
    }
  }

  if (masa > 0) for (const [token, g] of udzialy) udzialy.set(token, g / masa);
  rozlozone.set(p.id, { przepis: p, makro, udzialy, masa });

  const zBTW = makro.bialko * 4 + makro.tluszcz * 9 + makro.wegle * 4;
  if (makro.kcal > 0 && Math.abs(zBTW - makro.kcal) / makro.kcal > PROG_ROZJAZDU_KCAL) {
    blad(gdzie, `kcal (${Math.round(makro.kcal)}) nie zgadza się z B/T/W (${Math.round(zBTW)})`);
  }
}

// wymaganeDodatki muszą mieć czym się wypełnić
const dostepneKategorieDodatkow = new Set(przepisy.map((p) => p.kategoriaDania).filter(Boolean));
for (const p of przepisy) {
  for (const kat of p.wymaganeDodatki ?? []) {
    if (!dostepneKategorieDodatkow.has(kat)) {
      blad(`przepis ${p.id}`, `wymaga dodatku "${kat}", ale żaden przepis nie ma takiej kategoriaDania`);
    }
  }
}

// ---------------------------------------------------------------------------------------
// Pokrywające się przepisy
// ---------------------------------------------------------------------------------------
/**
 * Podobieństwo = ile masy obu przepisów to te same składniki (suma min(udziałA, udziałB)).
 * Ważenie masą jest tu istotne: dwa dania dzielące jajko i mąkę są różne, jeśli jedno w 60%
 * składa się z kurczaka. Zwykły Jaccard na zbiorach id-ków tego nie odróżnia.
 */
function podobienstwo(a, b) {
  let wspolne = 0;
  for (const [token, udzial] of a.udzialy) {
    const drugi = b.udzialy.get(token);
    if (drugi !== undefined) wspolne += Math.min(udzial, drugi);
  }
  return wspolne;
}

const pary = [];
const lista = [...rozlozone.values()].filter((r) => r.masa > 0);
for (let i = 0; i < lista.length; i++) {
  for (let j = i + 1; j < lista.length; j++) {
    const wynik = podobienstwo(lista[i], lista[j]);
    if (wynik >= PROG_PODOBIENSTWA) pary.push({ a: lista[i], b: lista[j], wynik });
  }
}
pary.sort((x, y) => y.wynik - x.wynik);

// ---------------------------------------------------------------------------------------
// Składniki, których nikt nie używa
// ---------------------------------------------------------------------------------------
const uzywane = new Set();
for (const { przepis: p } of rozlozone.values()) {
  for (const pozycja of p.skladniki ?? []) {
    if (jestGrupa(pozycja)) for (const s of skladniki) { if (s.kategoria === pozycja.kategoria) uzywane.add(s.id); }
    else if (jestKomponent(pozycja)) {
      for (const s of komponentPoId.get(pozycja.komponentId)?.skladniki ?? []) uzywane.add(s.skladnikId);
    } else uzywane.add(pozycja.skladnikId);
  }
}
// Podstawowe zapasy i produkty dokładane przez tryb "z lodówki" nie muszą być w żadnym przepisie.
const nieuzywane = skladniki.filter((s) => !uzywane.has(s.id) && !s.zawszeWDomu).map((s) => s.id);

// ---------------------------------------------------------------------------------------
// Tryb "pokaż mi jeden przepis"
// ---------------------------------------------------------------------------------------
if (typeof flagi.przepis === "string") {
  const trafione = [...rozlozone.values()].filter((r) => r.przepis.id.includes(flagi.przepis));
  if (trafione.length === 0) {
    console.log(`Nie znalazłem przepisu pasującego do "${flagi.przepis}".`);
    process.exit(1);
  }
  for (const { przepis: p, makro } of trafione) {
    console.log(`\n${p.nazwa}  —  ${p.porcje} porcji, sloty: ${p.slot.join(", ")}`);
    const wiersze = [];
    for (const pozycja of p.skladniki) {
      for (const { skladnik, gramy: g } of rozloz(pozycja, `przepis ${p.id}`)) {
        wiersze.push([skladnik.nazwa, g, (skladnik.makroNa100g.kcal * g) / 100]);
      }
    }
    wiersze.sort((a, b) => b[2] - a[2]);
    for (const [nazwa, g, kcal] of wiersze) {
      console.log(`  ${nazwa.padEnd(34)} ${String(Math.round(g)).padStart(5)} g  ${String(Math.round(kcal)).padStart(5)} kcal`);
    }
    const porcja = Object.fromEntries(CELE.map((c) => [c, makro[c] / p.porcje]));
    const proc = (g, kcalNaGram) => Math.round(((g * kcalNaGram) / porcja.kcal) * 100);
    console.log(`  ${"".padEnd(34)} ${"".padStart(5)}    ${"-".repeat(5)}`);
    console.log(`  CAŁOŚĆ: ${Math.round(makro.kcal)} kcal | B ${makro.bialko.toFixed(1)} T ${makro.tluszcz.toFixed(1)} W ${makro.wegle.toFixed(1)}`);
    console.log(`  PORCJA: ${Math.round(porcja.kcal)} kcal | B ${porcja.bialko.toFixed(1)} T ${porcja.tluszcz.toFixed(1)} W ${porcja.wegle.toFixed(1)}`);
    console.log(`  udział: B ${proc(porcja.bialko, 4)}% / T ${proc(porcja.tluszcz, 9)}% / W ${proc(porcja.wegle, 4)}%`);
  }
  console.log("");
}

// ---------------------------------------------------------------------------------------
// Raport
// ---------------------------------------------------------------------------------------
console.log(`Baza: ${przepisy.length} przepisów, ${skladniki.length} składników, ${komponenty.length} komponentów.`);

if (pary.length > 0) {
  console.log(`\nPOKRYWAJĄCE SIĘ PRZEPISY (próg ${Math.round(PROG_PODOBIENSTWA * 100)}% wspólnej masy):`);
  for (const { a, b, wynik } of pary) {
    const wspolne = [...a.udzialy.keys()]
      .filter((t) => b.udzialy.has(t))
      .map((t) => t.replace("grupa:", "dowolny/a "))
      .join(", ");
    console.log(`  ${Math.round(wynik * 100)}%  ${a.przepis.id}  ~  ${b.przepis.id}`);
    console.log(`        wspólne: ${wspolne}`);
  }
}

if (nieuzywane.length > 0) {
  console.log(`\nSKŁADNIKI W BAZIE, ALE W ŻADNYM PRZEPISIE (${nieuzywane.length}):`);
  console.log(`  ${nieuzywane.join(", ")}`);
  console.log("  (to nie musi być błąd — tryb \"z lodówki\" składa dania z szablonów, nie tylko z przepisów)");
}

if (ostrzezenia.length > 0) {
  console.log(`\nOSTRZEŻENIA (${ostrzezenia.length}):`);
  for (const o of ostrzezenia) console.log(`  - ${o}`);
}

if (bledy.length > 0) {
  console.log(`\nBŁĘDY (${bledy.length}):`);
  for (const b of bledy) console.log(`  - ${b}`);
  console.log("\nBaza NIE jest spójna.");
  process.exit(1);
}

console.log(`\nReferencje i makro: OK.`);
if (flagi.strict && (ostrzezenia.length > 0 || pary.length > 0)) {
  console.log("Tryb --strict: ostrzeżenia traktowane jak błędy.");
  process.exit(1);
}
