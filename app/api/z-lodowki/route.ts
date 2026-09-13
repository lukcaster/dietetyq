import { NextRequest, NextResponse } from "next/server";
import { rozpiszZLodowki, type PozycjaKoszyka, type ZapytanieZLodowki } from "@/lib/engine/z-lodowki";

function waliduj(body: unknown): { ok: true; req: ZapytanieZLodowki } | { ok: false; blad: string } {
  if (typeof body !== "object" || body === null) return { ok: false, blad: "Brak danych w body" };
  const req = body as Partial<ZapytanieZLodowki>;

  if (!req.kcalDzienne && !req.dane) {
    return { ok: false, blad: "Podaj 'kcalDzienne' albo 'dane' (waga/wzrost/wiek/plec/aktywnosc/cel)" };
  }
  if (!Array.isArray(req.sloty) || req.sloty.length === 0) {
    return { ok: false, blad: "Podaj niepustą tablicę 'sloty'" };
  }
  if (!Array.isArray(req.koszyk) || req.koszyk.length === 0) {
    return { ok: false, blad: "Podaj niepusty 'koszyk' — to, co masz w lodówce" };
  }

  for (const pozycja of req.koszyk as PozycjaKoszyka[]) {
    if (typeof pozycja?.id !== "string" || pozycja.id.length === 0) {
      return { ok: false, blad: "Każda pozycja koszyka musi mieć 'id'" };
    }
    if (pozycja.jednostka !== "g" && pozycja.jednostka !== "szt") {
      return { ok: false, blad: `Nieprawidłowa jednostka dla "${pozycja.id}" — dozwolone: g, szt` };
    }
    if (
      pozycja.dostepneIlosc !== undefined &&
      (typeof pozycja.dostepneIlosc !== "number" || !Number.isFinite(pozycja.dostepneIlosc))
    ) {
      return { ok: false, blad: `'dostepneIlosc' dla "${pozycja.id}" musi być liczbą` };
    }
  }

  if (req.makro !== undefined) {
    const wartosci = [req.makro.bialko, req.makro.tluszcz, req.makro.wegle];
    if (wartosci.some((w) => typeof w !== "number" || !Number.isFinite(w) || w < 0)) {
      return { ok: false, blad: "'makro' musi mieć bialko/tluszcz/wegle jako liczby nieujemne (procenty kcal)" };
    }
    const suma = wartosci.reduce((s, w) => s + w, 0);
    if (Math.abs(suma - 100) > 1) {
      return { ok: false, blad: `Procenty makro muszą sumować się do 100 (jest ${Math.round(suma)})` };
    }
  }

  return {
    ok: true,
    req: {
      kcalDzienne: req.kcalDzienne,
      dane: req.dane,
      makro: req.makro,
      sloty: req.sloty,
      koszyk: req.koszyk,
      restrykcje: req.restrykcje ?? [],
    },
  };
}

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
    return NextResponse.json(rozpiszZLodowki(walidacja.req));
  } catch (err) {
    const wiadomosc = err instanceof Error ? err.message : "Nieznany błąd";
    return NextResponse.json({ blad: wiadomosc }, { status: 400 });
  }
}
