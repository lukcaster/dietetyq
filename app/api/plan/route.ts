import { NextRequest, NextResponse } from "next/server";
import { generujPlan, type PlanRequest } from "@/lib/engine/planner";

function walidujRequest(body: unknown): { ok: true; req: PlanRequest } | { ok: false; blad: string } {
  if (typeof body !== "object" || body === null) return { ok: false, blad: "Brak danych w body" };
  const req = body as Partial<PlanRequest>;

  if (!req.kcalDzienne && !req.dane) {
    return { ok: false, blad: "Podaj 'kcalDzienne' albo 'dane' (waga/wzrost/wiek/plec/aktywnosc/cel)" };
  }
  if (!Array.isArray(req.sloty) || req.sloty.length === 0) {
    return { ok: false, blad: "Podaj niepustą tablicę 'sloty' (np. ['sniadanie','obiad','kolacja'])" };
  }

  if (req.makro !== undefined) {
    const { bialko, tluszcz, wegle } = req.makro;
    const wartosci = [bialko, tluszcz, wegle];
    if (wartosci.some((w) => typeof w !== "number" || !Number.isFinite(w) || w < 0)) {
      return { ok: false, blad: "'makro' musi mieć bialko/tluszcz/wegle jako liczby nieujemne (procenty kcal)" };
    }
    // Tolerancja 1 pkt proc. — user zaokrągla suwakami, a 33/33/34 to sensowny rozkład.
    const suma = wartosci.reduce((s, w) => s + w, 0);
    if (Math.abs(suma - 100) > 1) {
      return { ok: false, blad: `Procenty makro muszą sumować się do 100 (jest ${Math.round(suma)})` };
    }
  }

  for (const pole of ["lubianeSkladniki", "nielubianeSkladniki"] as const) {
    const wartosc = req[pole];
    if (wartosc !== undefined && (!Array.isArray(wartosc) || wartosc.some((s) => typeof s !== "string"))) {
      return { ok: false, blad: `'${pole}' musi być tablicą id składników` };
    }
  }

  return {
    ok: true,
    req: {
      kcalDzienne: req.kcalDzienne,
      dane: req.dane,
      makro: req.makro,
      sloty: req.sloty,
      charakterPerSlot: req.charakterPerSlot,
      restrykcje: req.restrykcje ?? [],
      lubianeSkladniki: req.lubianeSkladniki ?? [],
      nielubianeSkladniki: req.nielubianeSkladniki ?? [],
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

  const walidacja = walidujRequest(body);
  if (!walidacja.ok) {
    return NextResponse.json({ blad: walidacja.blad }, { status: 400 });
  }

  try {
    const plan = generujPlan(walidacja.req);
    return NextResponse.json(plan);
  } catch (err) {
    const wiadomosc = err instanceof Error ? err.message : "Nieznany błąd generowania planu";
    return NextResponse.json({ blad: wiadomosc }, { status: 400 });
  }
}
