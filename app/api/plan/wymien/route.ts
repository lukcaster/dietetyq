import { NextRequest, NextResponse } from "next/server";
import { zaproponujZamienniki, type ZapytanieOZamiennik } from "@/lib/engine/planner";

/**
 * Wymiana jednego posiłku w gotowym planie: „nie chcę tego, daj coś innego".
 *
 * Zwraca 2-3 propozycje do wyboru, a nie jedną losową — user ma zobaczyć, co dostaje,
 * zanim zamieni.
 *
 * Endpoint jest osobny od `/api/plan`, bo świadomie NIE regeneruje planu — user zaakceptował
 * resztę tygodnia i zmiana jednej kolacji nie ma mu przestawić wszystkiego innego.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ blad: "Nieprawidłowy JSON w body" }, { status: 400 });
  }

  const req = body as Partial<ZapytanieOZamiennik>;
  if (!req.kcalDzienne && !req.dane) {
    return NextResponse.json({ blad: "Podaj 'kcalDzienne' albo 'dane'" }, { status: 400 });
  }
  if (!Array.isArray(req.sloty) || req.sloty.length === 0 || typeof req.slot !== "string") {
    return NextResponse.json({ blad: "Podaj 'sloty' oraz 'slot' do wymiany" }, { status: 400 });
  }

  try {
    const propozycje = zaproponujZamienniki(
      {
        ...req,
        sloty: req.sloty,
        slot: req.slot,
        restrykcje: req.restrykcje ?? [],
      } as ZapytanieOZamiennik,
      3
    );

    if (propozycje.length === 0) {
      return NextResponse.json(
        { blad: "Nie ma czym tego zastąpić — przy tych restrykcjach i sprzęcie skończyły się dania na ten posiłek." },
        { status: 409 }
      );
    }
    return NextResponse.json({ propozycje });
  } catch (err) {
    return NextResponse.json({ blad: err instanceof Error ? err.message : "Nieznany błąd" }, { status: 400 });
  }
}
