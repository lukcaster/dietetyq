import fs from "fs";
import path from "path";
import type { Ingredient, Component, Recipe, Produkt, SzablonDania } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

function wczytaj<T>(plik: string): T {
  const surowy = fs.readFileSync(path.join(DATA_DIR, plik), "utf-8");
  return JSON.parse(surowy) as T;
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
 * Produkty z OFF czytamy raz i trzymamy w pamięci — plik ma ~1 MB i kilka tysięcy pozycji,
 * a wyszukiwarka odpytuje go przy każdym wpisanym znaku. Kuratorowane pliki (ingredients,
 * recipes) świadomie zostają bez cache'u, żeby ich ręczna edycja działała od razu w dev.
 */
let cacheProduktow: Produkt[] | null = null;

export function getProdukty(): Produkt[] {
  if (cacheProduktow) return cacheProduktow;
  const sciezka = path.join(DATA_DIR, "produkty.json");
  // Plik jest opcjonalny: bez uruchomionego importu aplikacja ma działać na samej bazie.
  cacheProduktow = fs.existsSync(sciezka) ? (JSON.parse(fs.readFileSync(sciezka, "utf-8")) as Produkt[]) : [];
  return cacheProduktow;
}

export function getIngredientById(id: string): Ingredient {
  const skladnik = getIngredients().find((s) => s.id === id);
  if (!skladnik) throw new Error(`Nieznany składnik: ${id}`);
  return skladnik;
}

export function getComponentById(id: string): Component {
  const komponent = getComponents().find((k) => k.id === id);
  if (!komponent) throw new Error(`Nieznany komponent: ${id}`);
  return komponent;
}
