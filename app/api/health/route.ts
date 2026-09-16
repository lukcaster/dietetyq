import { NextResponse } from "next/server";

/**
 * Najtańszy możliwy endpoint — nie dotyka `data/*.json` ani silnika. Służy do budzenia
 * darmowej instancji na Renderze (patrz .github/workflows/keep-alive.yml): serwis usypia
 * po ~15 min bez ruchu, a zimny start trwa do minuty.
 *
 * `force-dynamic`, bo odpowiedź zbudowana w czasie buildu nie byłaby żadnym pingiem —
 * Render mógłby oddać ją z cache'u, nie budząc aplikacji.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, czas: new Date().toISOString() });
}
