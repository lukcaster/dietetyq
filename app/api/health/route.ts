import { NextResponse } from "next/server";

/**
 * Najtańszy możliwy endpoint — nie dotyka `data/*.json` ani silnika. Mówi tylko tyle, że
 * instancja odpowiada.
 *
 * Nic go cyklicznie nie wywołuje i to jest celowe: keep-alive, który trzymał darmowy serwis
 * non stop, zjadał ~730 z 750 godzin miesięcznego limitu Rendera (patrz README). Serwis usypia
 * po ~15 min bez ruchu i tak zostaje — pierwsze wejście po przerwie trwa do minuty.
 *
 * `force-dynamic`, bo odpowiedź zbudowana w czasie buildu nie powiedziałaby nic o tym,
 * czy aplikacja faktycznie wstała.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, czas: new Date().toISOString() });
}
