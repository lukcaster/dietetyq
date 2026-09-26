import { NextRequest, NextResponse } from "next/server";
import { zbudujPosilekZWybranegoPrzepisu, type ZapytanieOPosilekZPrzepisu } from "@/lib/engine/planner";

/**
 * Składa posiłek z przepisu **wskazanego przez usera** (tryb „ułożę plan sam").
 *
 * Osobny endpoint od `/api/plan/wymien`, bo tam silnik sam wybiera kandydata z rankingu,
 * a tutaj wybór jest już podjęty — zostaje tylko dobranie dodatków i przeskalowanie do celu.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ blad: "Nieprawidłowy JSON w body" }, { status: 400 });
  }

  const req = body as Partial<ZapytanieOPosilekZPrzepisu>;
  if (!req.kcalDzienne && !req.dane) {
    return NextResponse.json({ blad: "Podaj 'kcalDzienne' albo 'dane'" }, { status: 400 });
  }
  if (!Array.isArray(req.sloty) || req.sloty.length === 0 || typeof req.slot !== "string") {
    return NextResponse.json({ blad: "Podaj 'sloty' oraz 'slot'" }, { status: 400 });
  }
  if (typeof req.recipeId !== "string" || !req.recipeId) {
    return NextResponse.json({ blad: "Podaj 'recipeId'" }, { status: 400 });
  }

  try {
    const posilek = zbudujPosilekZWybranegoPrzepisu({
      ...req,
      sloty: req.sloty,
      slot: req.slot,
      recipeId: req.recipeId,
      restrykcje: req.restrykcje ?? [],
    } as ZapytanieOPosilekZPrzepisu);

    if (!posilek) {
      return NextResponse.json(
        { blad: "Tego przepisu nie da się użyć — nie ma go w bazie albo wypada przez restrykcje." },
        { status: 409 }
      );
    }
    return NextResponse.json(posilek);
  } catch (err) {
    return NextResponse.json({ blad: err instanceof Error ? err.message : "Nieznany błąd" }, { status: 400 });
  }
}
