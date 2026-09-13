import { NextRequest, NextResponse } from "next/server";
import { zbudujPosilekWlasny, type PozycjaKreatora, type ZapytanieKreatora } from "@/lib/engine/kreator";
import type { Makro } from "@/lib/engine/types";

const JEDNOSTKI = ["g", "ml", "szt"] as const;

function liczbaDodatnia(wartosc: unknown): wartosc is number {
  return typeof wartosc === "number" && Number.isFinite(wartosc) && wartosc >= 0;
}

function walidujMakro(wartosc: unknown): wartosc is Makro {
  if (typeof wartosc !== "object" || wartosc === null) return false;
  const m = wartosc as Record<string, unknown>;
  return ["kcal", "bialko", "tluszcz", "wegle"].every((klucz) => liczbaDodatnia(m[klucz]));
}

function walidujRequest(body: unknown): { ok: true; req: ZapytanieKreatora } | { ok: false; blad: string } {
  if (typeof body !== "object" || body === null) return { ok: false, blad: "Brak danych w body" };
  const req = body as Record<string, unknown>;

  if (typeof req.slot !== "string" || !req.slot) return { ok: false, blad: "Podaj 'slot' (np. 'obiad')" };
  if (!Array.isArray(req.pozycje) || req.pozycje.length === 0) {
    return { ok: false, blad: "Podaj niepustą tablicę 'pozycje' (składniki posiłku)" };
  }

  const pozycje: PozycjaKreatora[] = [];
  for (const surowa of req.pozycje) {
    if (typeof surowa !== "object" || surowa === null) return { ok: false, blad: "Pozycja musi być obiektem" };
    const p = surowa as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id) return { ok: false, blad: "Każda pozycja potrzebuje 'id' ze spiżarni" };
    if (!liczbaDodatnia(p.ilosc)) return { ok: false, blad: `Nieprawidłowa 'ilosc' dla pozycji ${p.id}` };
    if (typeof p.jednostka !== "string" || !JEDNOSTKI.includes(p.jednostka as (typeof JEDNOSTKI)[number])) {
      return { ok: false, blad: `Nieprawidłowa 'jednostka' dla pozycji ${p.id} (dozwolone: ${JEDNOSTKI.join(", ")})` };
    }
    pozycje.push({
      id: p.id,
      ilosc: p.ilosc,
      jednostka: p.jednostka as PozycjaKreatora["jednostka"],
      stala: p.stala === true,
      min: liczbaDodatnia(p.min) ? p.min : undefined,
      max: liczbaDodatnia(p.max) ? p.max : undefined,
    });
  }

  if (req.cel !== undefined && !walidujMakro(req.cel)) {
    return { ok: false, blad: "'cel' musi mieć kcal/bialko/tluszcz/wegle jako liczby nieujemne" };
  }
  if (req.dopasuj === true && req.cel === undefined) {
    return { ok: false, blad: "Dopasowanie wymaga podania 'cel' (makro posiłku)" };
  }

  return {
    ok: true,
    req: {
      slot: req.slot,
      nazwa: typeof req.nazwa === "string" ? req.nazwa : undefined,
      pozycje,
      restrykcje: Array.isArray(req.restrykcje) ? req.restrykcje.filter((r): r is string => typeof r === "string") : [],
      cel: req.cel as Makro | undefined,
      dopasuj: req.dopasuj === true,
    },
  };
}

/**
 * Liczy makro posiłku złożonego ręcznie i — gdy `dopasuj` — dobiera gramatury
 * pozycji elastycznych tak, żeby trafić w podany cel makro.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ blad: "Nieprawidłowy JSON w body" }, { status: 400 });
  }

  const walidacja = walidujRequest(body);
  if (!walidacja.ok) return NextResponse.json({ blad: walidacja.blad }, { status: 400 });

  try {
    return NextResponse.json(zbudujPosilekWlasny(walidacja.req));
  } catch (err) {
    const wiadomosc = err instanceof Error ? err.message : "Nieznany błąd budowania posiłku";
    return NextResponse.json({ blad: wiadomosc }, { status: 400 });
  }
}
