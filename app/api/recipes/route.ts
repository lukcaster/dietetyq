import { NextRequest, NextResponse } from "next/server";
import { getRecipes } from "@/lib/engine/data";
import { rozwiazPrzepis, zbudujFiltr } from "@/lib/engine/macro";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slot = searchParams.get("slot");
  const charakter = searchParams.get("charakter");
  const rozdziel = (wartosc: string | null) =>
    wartosc ? wartosc.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const filtr = zbudujFiltr(rozdziel(searchParams.get("wyklucz")), rozdziel(searchParams.get("nielubiane")));

  let przepisy = getRecipes();
  if (slot) przepisy = przepisy.filter((r) => r.slot.includes(slot));
  if (charakter) przepisy = przepisy.filter((r) => r.charakter === charakter);

  const wynik = przepisy.map((przepis) => {
    const rozwiazany = rozwiazPrzepis(przepis, filtr);
    return {
      id: przepis.id,
      nazwa: przepis.nazwa,
      slot: przepis.slot,
      charakter: przepis.charakter,
      porcje: przepis.porcje,
      czasPrzygotowania: przepis.czasPrzygotowania,
      czasOczekiwania: przepis.czasOczekiwania ?? null,
      instrukcje: przepis.instrukcje,
      wykonalnyPrzyRestrykcjach: rozwiazany !== null,
      makroCalkowite: rozwiazany?.makroCalkowite ?? null,
      makroNaPorcje: rozwiazany?.makroNaPorcje ?? null,
    };
  });

  return NextResponse.json({ przepisy: wynik });
}
