#!/usr/bin/env node
/**
 * Offline import produktów z Open Food Facts do data/produkty.json.
 *
 * Świadomie NIE odpytujemy OFF w runtime: dane są crowdsourcowane i niestabilne,
 * a silnik ma mieć deterministyczne wejście. Skrypt uruchamiamy ręcznie, wynik
 * ląduje w repo i przechodzi review jak każdy inny plik z danymi.
 *
 * Użycie:
 *   node scripts/import-off.mjs [--strony=60] [--rozmiar=100] [--wyjscie=data/produkty.json]
 */

import fs from "node:fs";
import path from "node:path";

const ENDPOINT = "https://search.openfoodfacts.org/search";
const KONTAKT = "dietetyq/0.1 (kontakt: gruchala.lukasz1@gmail.com)";
/**
 * Sam filtr po kraju daje głównie międzynarodowe słodycze i napoje z obcojęzycznymi
 * nazwami ("Geröstete Mandel"), bo to one mają najwięcej skanów. `lang:pl` zawęża do
 * produktów opisanych po polsku, czyli tego, co user faktycznie znajdzie na półce.
 */
const ZAPYTANIE = 'countries_tags:"en:poland" AND lang:pl';
const POLA = ["code", "product_name", "brands", "quantity", "nutriments", "allergens_tags", "unique_scans_n"];
/** OFF bywa kapryśny przy szybkim odpytywaniu — nie ścigamy się. */
const PRZERWA_MS = 1200;
const PROBY = 3;

/** Mapowanie tagów alergenów OFF na nasz zestaw tagów z ingredients.json. */
const MAPA_ALERGENOW = {
  "en:milk": "laktoza",
  "en:gluten": "gluten",
  "en:wheat": "gluten",
  "en:barley": "gluten",
  "en:rye": "gluten",
  "en:oats": "gluten",
  "en:spelt": "gluten",
  "en:kamut": "gluten",
  "en:nuts": "orzechy",
  "en:peanuts": "orzechy",
  "en:hazelnut": "orzechy",
  "en:hazelnuts": "orzechy",
  "en:almond": "orzechy",
  "en:almonds": "orzechy",
  "en:walnut": "orzechy",
  "en:walnuts": "orzechy",
  "en:cashew": "orzechy",
  "en:cashew-nuts": "orzechy",
  "en:pistachio": "orzechy",
  "en:pistachio-nuts": "orzechy",
  "en:pecan-nuts": "orzechy",
  "en:macadamia-nuts": "orzechy",
  "en:brazil-nuts": "orzechy",
  "en:eggs": "jajka",
  "en:egg": "jajka",
  "en:soybeans": "soja",
  "en:soy": "soja",
  "en:soya": "soja",
};

function argumenty() {
  const wynik = { strony: 60, rozmiar: 100, wyjscie: "data/produkty.json" };
  for (const arg of process.argv.slice(2)) {
    const [klucz, wartosc] = arg.replace(/^--/, "").split("=");
    if (klucz in wynik) wynik[klucz] = klucz === "wyjscie" ? wartosc : Number(wartosc);
  }
  return wynik;
}

function spij(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pobierzStrone(strona, rozmiar) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("q", ZAPYTANIE);
  url.searchParams.set("page", String(strona));
  url.searchParams.set("page_size", String(rozmiar));
  url.searchParams.set("sort_by", "-unique_scans_n");
  url.searchParams.set("fields", POLA.join(","));

  for (let proba = 1; proba <= PROBY; proba++) {
    try {
      const odpowiedz = await fetch(url, { headers: { "User-Agent": KONTAKT } });
      if (!odpowiedz.ok) throw new Error(`HTTP ${odpowiedz.status}`);
      const dane = await odpowiedz.json();
      if (!Array.isArray(dane.hits)) throw new Error("odpowiedź bez pola 'hits'");
      return dane.hits;
    } catch (err) {
      if (proba === PROBY) throw new Error(`strona ${strona} nie pobrana: ${err.message}`);
      await spij(PRZERWA_MS * 3 * proba);
    }
  }
  return [];
}

function liczba(wartosc) {
  const n = typeof wartosc === "string" ? Number(wartosc) : wartosc;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function zaokr(n) {
  return Math.round(n * 10) / 10;
}

function normalizuj(tekst) {
  return (tekst ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Odrzuca produkty, których makro nie trzyma się kupy — najczęstszy błąd w OFF to
 * wartości podane na porcję zamiast na 100 g, co po przeskalowaniu rozwaliłoby plan.
 */
function makroWiarygodne(makro) {
  const { kcal, bialko, tluszcz, wegle } = makro;
  if (kcal <= 0 || kcal > 900) return false;
  if (bialko < 0 || tluszcz < 0 || wegle < 0) return false;
  if (bialko + tluszcz + wegle > 100) return false;
  const zeSkladu = 4 * bialko + 9 * tluszcz + 4 * wegle;
  const roznica = Math.abs(zeSkladu - kcal);
  return roznica <= 50 || roznica / kcal <= 0.3;
}

function mapujProdukt(hit) {
  const nazwa = (hit.product_name ?? "").trim();
  if (!nazwa || nazwa.length > 120) return null;
  if (!hit.code) return null;

  const n = hit.nutriments ?? {};
  const makro = {
    kcal: liczba(n["energy-kcal_100g"]),
    bialko: liczba(n.proteins_100g),
    tluszcz: liczba(n.fat_100g),
    wegle: liczba(n.carbohydrates_100g),
  };
  if (Object.values(makro).some((w) => w === null)) return null;
  if (!makroWiarygodne(makro)) return null;

  const tagi = Array.isArray(hit.allergens_tags) ? hit.allergens_tags : [];
  const alergeny = [...new Set(tagi.map((t) => MAPA_ALERGENOW[t]).filter(Boolean))];

  const marki = Array.isArray(hit.brands) ? hit.brands : hit.brands ? [hit.brands] : [];
  const marka = (marki[0] ?? "").trim();

  return {
    kod: String(hit.code),
    nazwa,
    ...(marka ? { marka } : {}),
    makroNa100g: {
      kcal: zaokr(makro.kcal),
      bialko: zaokr(makro.bialko),
      tluszcz: zaokr(makro.tluszcz),
      wegle: zaokr(makro.wegle),
    },
    tagiAlergenow: alergeny.sort(),
    // Pusta lista tagów w OFF nie znaczy "bez alergenów", tylko "nikt tego nie uzupełnił".
    // UI musi to pokazać, bo inaczej filtr restrykcji cicho przepuści np. produkt mleczny.
    alergenyNieznane: tagi.length === 0,
    popularnosc: liczba(hit.unique_scans_n) ?? 0,
  };
}

async function main() {
  const { strony, rozmiar, wyjscie } = argumenty();
  console.log(`Import z OFF: ${strony} stron x ${rozmiar} produktów, kraj = Polska, sort = popularność`);

  const wgKlucza = new Map();
  let pobrane = 0;
  let odrzucone = 0;

  for (let strona = 1; strona <= strony; strona++) {
    const hits = await pobierzStrone(strona, rozmiar);
    if (hits.length === 0) {
      console.log(`Strona ${strona}: pusta — kończę wcześniej.`);
      break;
    }
    pobrane += hits.length;

    for (const hit of hits) {
      const produkt = mapujProdukt(hit);
      if (!produkt) {
        odrzucone++;
        continue;
      }
      const klucz = `${normalizuj(produkt.nazwa)}|${normalizuj(produkt.marka ?? "")}`;
      const istniejacy = wgKlucza.get(klucz);
      if (!istniejacy || istniejacy.popularnosc < produkt.popularnosc) wgKlucza.set(klucz, produkt);
    }

    if (strona % 10 === 0 || strona === strony) {
      console.log(`  strona ${strona}/${strony} — przyjęte: ${wgKlucza.size}, odrzucone: ${odrzucone}`);
    }
    await spij(PRZERWA_MS);
  }

  const produkty = [...wgKlucza.values()].sort((a, b) => b.popularnosc - a.popularnosc);
  const sciezka = path.resolve(process.cwd(), wyjscie);
  fs.mkdirSync(path.dirname(sciezka), { recursive: true });
  fs.writeFileSync(sciezka, JSON.stringify(produkty) + "\n", "utf-8");

  const nieznane = produkty.filter((p) => p.alergenyNieznane).length;
  console.log(`\nGotowe: ${produkty.length} produktów → ${wyjscie}`);
  console.log(`  pobrane surowo: ${pobrane}, odrzucone (braki/niespójne makro): ${odrzucone}`);
  console.log(`  bez wypełnionych alergenów (oznaczone jako nieznane): ${nieznane}`);
  console.log(`  rozmiar pliku: ${(fs.statSync(sciezka).size / 1024).toFixed(0)} kB`);
}

main().catch((err) => {
  console.error("Import przerwany:", err.message);
  process.exit(1);
});
