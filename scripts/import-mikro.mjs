/**
 * Weryfikacja/uzupełnienie mikroskładników w data/ingredients.json z USDA FoodData Central.
 *
 * Wartości w repo są kuratorowane ręcznie z tabel wartości odżywczych — tak samo jak makro
 * (patrz SPEC). Ten skrypt pozwala je porównać z USDA i podmienić, bo to jest jedyne darmowe
 * źródło z porządnym pokryciem mikroskładników dla surowców generycznych.
 *
 * Klucz USDA jest darmowy (rejestracja: https://fdc.nal.usda.gov/api-key-signup.html).
 * DEMO_KEY ma limit ~8 zapytań/godzinę, więc na 65 składników się nie nadaje.
 *
 *   node scripts/import-mikro.mjs --klucz=TWOJ_KLUCZ            # tylko raport różnic
 *   node scripts/import-mikro.mjs --klucz=TWOJ_KLUCZ --zapisz   # nadpisuje ingredients.json
 *   node scripts/import-mikro.mjs --klucz=... --tylko=szpinak,jajko
 *
 * Świadomie NIE mapujemy tu wszystkiego automatycznie po nazwie: "mleko A2" czy "odżywka
 * białkowa" nie mają odpowiednika w USDA, a dopasowanie na ślepo wstawiłoby dane losowego
 * produktu. Składniki bez wpisu w MAPOWANIE są pomijane i zostają przy wartościach z repo.
 */

import fs from "fs";
import path from "path";

const SCIEZKA = path.join(process.cwd(), "data", "ingredients.json");

/** id z ingredients.json → fraza wyszukiwania w USDA (bazy SR Legacy / Foundation). */
const MAPOWANIE = {
  "platki-owsiane": "oats raw",
  "mleko-krowie": "milk whole 3.25%",
  "wiorki-kokosowe": "coconut meat dried unsweetened",
  "maslo-orzechowe": "peanut butter smooth without salt",
  miod: "honey",
  borowki: "blueberries raw",
  maliny: "raspberries raw",
  truskawki: "strawberries raw",
  "siemie-chia": "chia seeds dried",
  "jogurt-naturalny": "yogurt plain whole milk",
  "maka-pszenna-pelnoziarnista": "wheat flour whole grain",
  "maka-pszenna": "wheat flour white all-purpose enriched",
  jajko: "egg whole raw fresh",
  szpinak: "spinach raw",
  feta: "cheese feta",
  cebula: "onions raw",
  "indyk-mielony": "turkey ground raw",
  "olej-rzepakowy": "oil canola",
  "twarog-polnotlusty": "cheese cottage creamed",
  "tofu-naturalne": "tofu raw firm",
  kakao: "cocoa dry powder unsweetened",
  banan: "bananas raw",
  cytryna: "lemons raw without peel",
  "mieso-mielone-wolowe": "beef ground 90% lean raw",
  "kurczak-piers": "chicken breast boneless skinless raw",
  "tortilla-pszenna": "tortillas flour wheat",
  salami: "salami dry or hard pork",
  "ser-zolty": "cheese cheddar",
  "sos-pomidorowy": "tomato puree canned",
  keczup: "catsup",
  "ryz-bialy-surowy": "rice white long-grain regular raw",
  ziemniaki: "potatoes flesh and skin raw",
  "kasza-gryczana-surowa": "buckwheat groats",
  ogorek: "cucumber with peel raw",
  kapusta: "cabbage raw",
  pomidor: "tomatoes red ripe raw",
  "oliwa-z-oliwek": "oil olive salad or cooking",
  "drozdze-piekarskie": "leavening agents yeast bakers active dry",
  szynka: "ham sliced regular",
  rukola: "arugula raw",
  majonez: "mayonnaise regular",
  musztarda: "mustard prepared yellow",
  "kapusta-kiszona": "sauerkraut canned",
  chorizo: "sausage chorizo pork and beef",
  papryka: "peppers sweet red raw",
  boczek: "bacon pork raw",
  "chleb-pszenny": "bread white commercially prepared",
  mozzarella: "cheese mozzarella whole milk",
  salata: "lettuce butterhead raw",
  "maka-owsiana": "oat flour partially debranned",
  "maka-ryzowa": "rice flour white",
  "serek-wiejski": "cheese cottage lowfat 2%",
  daktyle: "dates medjool",
  "dzem-owocowy": "jams and preserves",
  pieczarki: "mushrooms white raw",
  "soczewica-zielona": "lentils raw",
  "bulka-tarta": "bread crumbs dry grated plain",
  "natka-pietruszki": "parsley fresh",
  pita: "bread pita white enriched",

  // --- pozycje z importu przepisów (patrz TODO 17) ---
  "chleb-zytni-razowy": "bread rye",
  "bulka-grahamka": "rolls hamburger or hotdog whole wheat",
  "chleb-bezglutenowy": "bread white wheat gluten free",
  "chleb-chrupki": "crackers rye wafers plain",
  "wafle-ryzowe": "rice cakes brown rice plain",
  "ryz-basmati": "rice white long-grain regular raw",
  "kasza-jaglana": "millet raw",
  "kasza-jeczmienna": "barley pearled raw",
  "kasza-kuskus": "couscous dry",
  "komosa-ryzowa": "quinoa uncooked",
  "makaron-pelnoziarnisty": "pasta whole wheat dry",
  "makaron-ryzowy": "rice noodles dry",
  batat: "sweet potato raw unprepared",
  "tunczyk-w-sosie-wlasnym": "fish tuna light canned in water drained",
  "tunczyk-swiezy": "fish tuna fresh yellowfin raw",
  "losos-swiezy": "fish salmon atlantic farmed raw",
  "losos-wedzony": "fish salmon chinook smoked",
  dorsz: "fish cod atlantic raw",
  mintaj: "fish pollock alaska raw",
  "makrela-wedzona": "fish mackerel atlantic smoked",
  "pstrag-wedzony": "fish trout rainbow farmed raw",
  "indyk-piers": "turkey breast meat only raw",
  "wolowina-rostbef": "beef round top round raw",
  "poledwica-wieprzowa": "pork fresh loin tenderloin raw",
  "szynka-z-indyka": "turkey ham cured",
  parmezan: "cheese parmesan hard",
  "napoj-sojowy": "soymilk unsweetened",
  "pomidorki-koktajlowe": "tomatoes red ripe raw",
  "seler-naciowy": "celery raw",
  rzodkiewka: "radishes raw",
  "biala-rzodkiew": "radishes oriental raw",
  roszponka: "lettuce green leaf raw",
  "kielki-rzodkiewki": "radish seeds sprouted raw",
  awokado: "avocados raw",
  baklazan: "eggplant raw",
  burak: "beets raw",
  "seler-korzeniowy": "celeriac raw",
  "pietruszka-korzen": "parsnips raw",
  por: "leeks raw",
  brokul: "broccoli raw",
  kalafior: "cauliflower raw",
  brukselka: "brussels sprouts raw",
  dynia: "pumpkin raw",
  jarmuz: "kale raw",
  boczniaki: "mushrooms oyster raw",
  "groszek-cukrowy": "peas edible-podded raw",
  "fasola-szparagowa": "beans snap green raw",
  "kukurydza-konserwowa": "corn sweet yellow canned drained",
  "oliwki-czarne": "olives ripe canned",
  "oliwki-zielone": "olives pickled green",
  kapary: "capers canned",
  "ciecierzyca-konserwowa": "chickpeas garbanzo beans canned",
  "fasola-czerwona-konserwowa": "beans kidney red canned",
  "fasola-biala-konserwowa": "beans white canned",
  hummus: "hummus commercial",
  tahini: "sesame butter tahini",
  "koncentrat-pomidorowy": "tomato paste canned",
  "chrzan-tarty": "horseradish prepared",
  "sos-ostrygowy": "sauce oyster ready-to-serve",
  "sos-rybny": "sauce fish ready-to-serve",
  "sos-barbecue": "sauce barbecue",
  migdaly: "nuts almonds",
  "orzechy-wloskie": "nuts walnuts english",
  "orzechy-nerkowca": "nuts cashew nuts raw",
  "orzechy-laskowe": "nuts hazelnuts or filberts",
  "mieszanka-orzechow": "nuts mixed nuts dry roasted",
  "pestki-dyni": "seeds pumpkin and squash seed kernels dried",
  "nasiona-slonecznika": "seeds sunflower seed kernels dried",
  "siemie-lniane": "seeds flaxseed",
  kiwi: "kiwifruit green raw",
  gruszka: "pears raw",
  pomarancza: "oranges raw all commercial varieties",
  mandarynki: "tangerines mandarin oranges raw",
  winogrona: "grapes red or green raw",
  melon: "melons cantaloupe raw",
  granat: "pomegranates raw",
  ananas: "pineapple raw all varieties",
  mango: "mangos raw",
  brzoskwinia: "peaches raw",
  wisnie: "cherries sweet raw",
  "sliwki-suszone": "plums dried prunes uncooked",
  "morele-suszone": "apricots dried sulfured uncooked",
  rodzynki: "raisins seedless",
};

/** klucz w naszym modelu → nazwa składnika odżywczego w USDA + oczekiwana jednostka. */
const SKLADNIKI_USDA = {
  blonnik: { nazwa: "Fiber, total dietary", jednostka: "G" },
  zelazo: { nazwa: "Iron, Fe", jednostka: "MG" },
  wapn: { nazwa: "Calcium, Ca", jednostka: "MG" },
  magnez: { nazwa: "Magnesium, Mg", jednostka: "MG" },
  potas: { nazwa: "Potassium, K", jednostka: "MG" },
  cynk: { nazwa: "Zinc, Zn", jednostka: "MG" },
  witaminaC: { nazwa: "Vitamin C, total ascorbic acid", jednostka: "MG" },
  sod: { nazwa: "Sodium, Na", jednostka: "MG" },
};

const argumenty = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const KLUCZ = argumenty.klucz ?? process.env.USDA_API_KEY;
if (!KLUCZ) {
  console.error("Podaj klucz: --klucz=... albo zmienna USDA_API_KEY");
  console.error("Darmowa rejestracja: https://fdc.nal.usda.gov/api-key-signup.html");
  process.exit(1);
}

const filtr = typeof argumenty.tylko === "string" ? new Set(argumenty.tylko.split(",")) : null;
const ZAPISZ = argumenty.zapisz === true;

const spij = (ms) => new Promise((r) => setTimeout(r, ms));

async function pobierz(fraza) {
  const url =
    `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(KLUCZ)}` +
    `&query=${encodeURIComponent(fraza)}&pageSize=1&dataType=${encodeURIComponent("SR Legacy,Foundation")}`;

  for (let proba = 0; proba < 3; proba++) {
    const odpowiedz = await fetch(url);
    if (odpowiedz.status === 429) {
      console.warn("  limit zapytań — czekam 60 s...");
      await spij(60_000);
      continue;
    }
    if (!odpowiedz.ok) throw new Error(`USDA ${odpowiedz.status}`);
    const dane = await odpowiedz.json();
    return dane.foods?.[0] ?? null;
  }
  throw new Error("Nie udało się pobrać po 3 próbach");
}

function wyciagnijMikro(zywnosc) {
  const wynik = {};
  for (const [klucz, oczekiwany] of Object.entries(SKLADNIKI_USDA)) {
    const trafienie = (zywnosc.foodNutrients ?? []).find((n) => n.nutrientName === oczekiwany.nazwa);
    if (!trafienie) {
      wynik[klucz] = null;
      continue;
    }
    if (trafienie.unitName !== oczekiwany.jednostka) {
      // Nie przeliczamy jednostek na ślepo — lepiej zgłosić, niż wstawić wartość 1000× za dużą.
      console.warn(`  ! ${klucz}: USDA podaje ${trafienie.unitName}, oczekiwano ${oczekiwany.jednostka} — pomijam`);
      wynik[klucz] = null;
      continue;
    }
    wynik[klucz] = Math.round(trafienie.value * 100) / 100;
  }
  return wynik;
}

const skladniki = JSON.parse(fs.readFileSync(SCIEZKA, "utf-8"));
const doPobrania = skladniki.filter((s) => MAPOWANIE[s.id] && (!filtr || filtr.has(s.id)));

console.log(`Sprawdzam ${doPobrania.length} składników w USDA...\n`);

let zmian = 0;
for (const skladnik of doPobrania) {
  const fraza = MAPOWANIE[skladnik.id];
  let zywnosc;
  try {
    zywnosc = await pobierz(fraza);
  } catch (blad) {
    console.error(`${skladnik.id}: ${blad.message}`);
    continue;
  }
  if (!zywnosc) {
    console.warn(`${skladnik.id}: brak trafień dla "${fraza}"`);
    continue;
  }

  const zUsda = wyciagnijMikro(zywnosc);
  const nasze = skladnik.mikroNa100g ?? {};
  const roznice = [];

  for (const [klucz, wartosc] of Object.entries(zUsda)) {
    if (wartosc === null) continue;
    const stara = nasze[klucz];
    // Interesują nas rozjazdy, które realnie zmieniają bilans — nie szum na drugim miejscu po przecinku.
    const istotna = stara === undefined || Math.abs(wartosc - stara) > Math.max(stara * 0.25, 0.5);
    if (istotna) roznice.push(`${klucz}: ${stara ?? "—"} → ${wartosc}`);
    if (ZAPISZ) {
      skladnik.mikroNa100g = { ...(skladnik.mikroNa100g ?? {}), [klucz]: wartosc };
    }
  }

  if (roznice.length > 0) {
    zmian++;
    console.log(`${skladnik.id}  (${zywnosc.description})`);
    for (const r of roznice) console.log(`   ${r}`);
  }

  await spij(200);
}

console.log(`\nSkładników z istotnymi różnicami: ${zmian}.`);

if (ZAPISZ) {
  fs.writeFileSync(SCIEZKA, JSON.stringify(skladniki, null, 2) + "\n", "utf-8");
  console.log("Zapisano ingredients.json (UWAGA: plik został przeformatowany przez JSON.stringify).");
} else {
  console.log("To był tylko raport. Dodaj --zapisz, żeby nadpisać wartości.");
}

const bezMapowania = skladniki.filter((s) => !MAPOWANIE[s.id]).map((s) => s.id);
if (bezMapowania.length > 0) {
  console.log(`\nBez odpowiednika w USDA (zostają przy wartościach z repo): ${bezMapowania.join(", ")}`);
}
