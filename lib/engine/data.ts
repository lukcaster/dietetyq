import fs from "fs";
import path from "path";
import type { Ingredient, Component, Recipe, Produkt, SzablonDania } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

/**
 * Kuratorowane pliki (ingredients, recipes, components, szablony) czytamy z dysku przy każdym
 * wywołaniu w dev — dzięki temu ręczna edycja JSON-a działa od razu, bez restartu serwera.
 *
 * Na produkcji trzymamy je w pamięci, bo silnik sięga po nie **bardzo** często: przy jednej
 * wymianie posiłku `rozwiazPrzepis` przechodzi przez 200 przepisów, a każdy składnik woła
 * `getIngredientById`, czyli kolejne odczytanie i sparsowanie pliku. Zmierzone przed zmianą:
 * 2,4-3,6 s na jedną wymianę.
 */
const cache = new Map<string, unknown>();

function wczytaj<T>(plik: string): T {
  if (process.env.NODE_ENV === "production") {
    const zapamietane = cache.get(plik);
    if (zapamietane !== undefined) return zapamietane as T;
  }
  const surowy = fs.readFileSync(path.join(DATA_DIR, plik), "utf-8");
  const dane = JSON.parse(surowy) as T;
  if (process.env.NODE_ENV === "production") cache.set(plik, dane);
  return dane;
}

export function getIngredients(): Ingredient[] {
  return wczytaj<Ingredient[]>("ingredients.json");
}

export function getComponents(): Component[] {
  return wczytaj<Component[]>("components.json");
}

export function getRecipes(): Recipe[] {
  return wczytaj<Recipe[]>("recipes.json");
}

export function getSzablony(): SzablonDania[] {
  return wczytaj<SzablonDania[]>("szablony.json");
}

/**
 * Produkty z OFF czytamy raz i trzymamy w pamięci **zawsze**, także w dev — plik ma ~1 MB
 * i kilka tysięcy pozycji, a wyszukiwarka odpytuje go przy każdym wpisanym znaku.
 */
let cacheProduktow: Produkt[] | null = null;

export function getProdukty(): Produkt[] {
  if (cacheProduktow) return cacheProduktow;
  const sciezka = path.join(DATA_DIR, "produkty.json");
  // Plik jest opcjonalny: bez uruchomionego importu aplikacja ma działać na samej bazie.
  cacheProduktow = fs.existsSync(sciezka) ? (JSON.parse(fs.readFileSync(sciezka, "utf-8")) as Produkt[]) : [];
  return cacheProduktow;
}

/**
 * Mapa id → składnik, przebudowywana tylko wtedy, gdy zmieni się tablica składników.
 * `find` po 218 pozycjach przy każdym wywołaniu był drugim po odczycie pliku kosztem silnika.
 */
let mapaSkladnikow: { zrodlo: Ingredient[]; mapa: Map<string, Ingredient> } | null = null;

export function getIngredientById(id: string): Ingredient {
  const skladniki = getIngredients();
  if (!mapaSkladnikow || mapaSkladnikow.zrodlo !== skladniki) {
    mapaSkladnikow = { zrodlo: skladniki, mapa: new Map(skladniki.map((s) => [s.id, s])) };
  }
  const skladnik = mapaSkladnikow.mapa.get(id);
  if (!skladnik) throw new Error(`Nieznany składnik: ${id}`);
  return skladnik;
}

export function getComponentById(id: string): Component {
  const komponent = getComponents().find((k) => k.id === id);
  if (!komponent) throw new Error(`Nieznany komponent: ${id}`);
  return komponent;
}
