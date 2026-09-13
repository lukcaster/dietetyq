import { NextRequest, NextResponse } from "next/server";
import type { SkladnikBazowyWPlanie } from "@/lib/engine/lista-zakupow";
import { zbudujBilans, type Plec } from "@/lib/engine/mikro";

interface Zapytanie {
  /** Jeden zestaw = jeden dzień. Plan tygodniowy wysyła siedem, tryb "z lodówki" jeden. */
  dni: SkladnikBazowyWPlanie[][];
  plec?: Plec;
}

function waliduj(body: unknown): { ok: true; req: Zapytanie } | { ok: false; blad: string } {
  if (typeof body !== "object" || body === null) return { ok: false, blad: "Brak danych w body" };
  const req = body as Partial<Zapytanie>;

  if (!Array.isArray(req.dni) || req.dni.length === 0) {
    return { ok: false, blad: "Podaj niepustą tablicę 'dni' (każdy to lista składników bazowych)" };
  }
  for (const dzien of req.dni) {
    if (!Array.isArray(dzien)) return { ok: false, blad: "Każdy element 'dni' musi być tablicą składników" };
    for (const s of dzien) {
      if (typeof s?.skladnikId !== "string" || typeof s?.ilosc !== "number" || !Number.isFinite(s.ilosc)) {
        return { ok: false, blad: "Każdy składnik potrzebuje 'skladnikId' i liczbowej 'ilosc'" };
      }
    }
  }
  if (req.plec !== undefined && req.plec !== "K" && req.plec !== "M") {
    return { ok: false, blad: "'plec' musi być 'K' albo 'M'" };
  }

  return { ok: true, req: { dni: req.dni, plec: req.plec } };
}

/**
 * Bilans mikroskładników dla podanych dni. Osobny endpoint, a nie pole w odpowiedzi planu,
 * bo bilans trzeba przeliczyć także po zmianach po stronie klienta — podmianie posiłku
 * w kreatorze albo ręcznej korekcie gramatur w trybie "z lodówki".
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
    const bilanse = walidacja.req.dni.map((dzien) => zbudujBilans(dzien, walidacja.req.plec ?? "M"));
    return NextResponse.json({ bilanse });
  } catch (err) {
    const wiadomosc = err instanceof Error ? err.message : "Nieznany błąd";
    return NextResponse.json({ blad: wiadomosc }, { status: 400 });
  }
}
