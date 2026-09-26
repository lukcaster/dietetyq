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
  // Domyślnie tylko dania główne — dodatki (ryż, surówka) nie są samodzielnym posiłkiem
  // i w przeglądarce przepisów wyglądałyby jak pomyłka. `kategoria=wszystko` je przywraca.
  if (searchParams.get("kategoria") !== "wszystko") {
    przepisy = przepisy.filter((r) => (r.kategoriaDania ?? "glowne") === "glowne");
  }
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
      rodzaj: przepis.rodzaj ?? null,
      kategoriaDania: przepis.kategoriaDania ?? "glowne",
      instrukcje: przepis.instrukcje,
      wykonalnyPrzyRestrykcjach: rozwiazany !== null,
      makroCalkowite: rozwiazany?.makroCalkowite ?? null,
      makroNaPorcje: rozwiazany?.makroNaPorcje ?? null,
    };
  });

  return NextResponse.json({ przepisy: wynik });
}
