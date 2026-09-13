import { NextRequest, NextResponse } from "next/server";
import { szukajWSpizarni } from "@/lib/engine/spizarnia";

/**
 * Wyszukiwarka składników do kreatora posiłku: kuratorowana baza + produkty sklepowe z OFF.
 * Trzymana po stronie serwera, bo produkty.json ma ~1 MB — nie ma sensu wysyłać go do przeglądarki.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const fraza = searchParams.get("q") ?? "";
  const restrykcje = (searchParams.get("restrykcje") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const limit = Number(searchParams.get("limit")) || 25;

  const pozycje = szukajWSpizarni(fraza, {
    limit: Math.min(Math.max(limit, 1), 50),
    restrykcje,
    dopuscNieznaneAlergeny: searchParams.get("dopuscNieznane") === "1",
    tylkoBaza: searchParams.get("tylkoBaza") === "1",
  });

  return NextResponse.json({ pozycje });
}
