import { NextRequest, NextResponse } from "next/server";
import type { Makro } from "@/lib/engine/types";
import { przeliczPosilek, type PozycjaDoKorekty } from "@/lib/engine/z-lodowki";

interface Zapytanie {
  cel: Makro;
  pozycje: PozycjaDoKorekty[];
}

const KLUCZE_MAKRO = ["kcal", "bialko", "tluszcz", "wegle"] as const;

function waliduj(body: unknown): { ok: true; req: Zapytanie } | { ok: false; blad: string } {
  if (typeof body !== "object" || body === null) return { ok: false, blad: "Brak danych w body" };
  const req = body as Partial<Zapytanie>;

  if (typeof req.cel !== "object" || req.cel === null) return { ok: false, blad: "Podaj 'cel' makro posiłku" };
  for (const klucz of KLUCZE_MAKRO) {
    const wartosc = req.cel[klucz];
    if (typeof wartosc !== "number" || !Number.isFinite(wartosc) || wartosc < 0) {
      return { ok: false, blad: `'cel.${klucz}' musi być liczbą nieujemną` };
    }
  }

  if (!Array.isArray(req.pozycje) || req.pozycje.length === 0) {
    return { ok: false, blad: "Podaj niepustą tablicę 'pozycje'" };
  }
  for (const pozycja of req.pozycje) {
    if (typeof pozycja?.id !== "string" || pozycja.id.length === 0) {
      return { ok: false, blad: "Każda pozycja musi mieć 'id'" };
    }
    if (pozycja.jednostka !== "g" && pozycja.jednostka !== "szt") {
      return { ok: false, blad: `Nieprawidłowa jednostka dla "${pozycja.id}" — dozwolone: g, szt` };
    }
    if (typeof pozycja.ilosc !== "number" || !Number.isFinite(pozycja.ilosc)) {
      return { ok: false, blad: `'ilosc' dla "${pozycja.id}" musi być liczbą` };
    }
  }

  return { ok: true, req: { cel: req.cel, pozycje: req.pozycje } };
}

/**
 * Ręczna korekta gotowego posiłku w trybie "z lodówki": user wpisuje gramaturę, na której
 * mu zależy, a solver przelicza resztę pod cel makro slotu. Skład posiłku się nie zmienia —
 * to poprawka konkretnego dania, a nie nowy dobór szablonu.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ blad: "Nieprawidłowy JSON w body" }, { status: 400 });
  }

  const walidacja = waliduj(body);
  if (!walidacja.ok) return NextResponse.json({ blad: walidacja.blad }, { status: 400 });

  try {
    return NextResponse.json(przeliczPosilek(walidacja.req.pozycje, walidacja.req.cel));
  } catch (err) {
    const wiadomosc = err instanceof Error ? err.message : "Nieznany błąd";
    return NextResponse.json({ blad: wiadomosc }, { status: 400 });
  }
}
