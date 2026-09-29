import { NextRequest, NextResponse } from "next/server";
import { domknijDzien } from "@/lib/engine/domykanie";
import { zbudujFiltr } from "@/lib/engine/macro";
import type { PosilekWPlanie } from "@/lib/engine/planner";
import type { Makro } from "@/lib/engine/types";

/**
 * „Domknij białko" dla dnia ułożonego ręcznie.
 *
 * Plan z silnika domyka się sam przy generowaniu (patrz planner.ts), ale dzień poskładany
 * z ręki — zwłaszcza z gotowców — nie miał jak: user widział „brakuje 23% białka" i tyle.
 * Ten endpoint robi dokładnie to samo, co silnik robi po cichu: dokłada do istniejących
 * posiłków zwykłe jedzenie (plaster szynki, jajko, trochę więcej mięsa do obiadu).
 *
 * Świadomie NIE przelicza gramatur całych dań. Przeskalowanie obiadu, żeby dobić białko,
 * zmieniłoby przepis, który user wybrał — a to jego plan. Dokładamy obok, jawnie.
 */
/**
 * Każdy powód prowadzi do innej decyzji usera, więc każdy dostaje własny tekst. Zbiorcze
 * „nie da się" jest ślepą uliczką — user klika drugi raz i dostaje to samo.
 */
const KOMUNIKATY: Record<NonNullable<ReturnType<typeof domknijDzien>["powod"]>, string> = {
  "brak-niedoboru": "Białka jest wystarczająco — nie ma czego domykać.",
  "limit-kcal":
    "Dzień jest już pełny kalorycznie, więc dokładanie jedzenia nic tu nie da. Żeby podbić białko, " +
    "trzeba coś podmienić, a nie dołożyć — spróbuj zamienić najmniej białkowy posiłek na inny.",
  "brak-kandydatow":
    "Wszystko, czym domykamy białko (szynka, ser, jajko, twaróg, skyr), odpada przez Twoje " +
    "restrykcje albo listę „nie jem tego”.",
  "brak-miejsca":
    "Nie ma gdzie tego dołożyć — każdy posiłek już coś dostał albo nic z naszej listy do niego nie pasuje.",
};

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ blad: "Nieprawidłowy JSON w body" }, { status: 400 });
  }

  const req = body as {
    posilki?: PosilekWPlanie[];
    celDnia?: Makro;
    restrykcje?: string[];
    nielubiane?: string[];
  };

  if (!Array.isArray(req.posilki) || req.posilki.length === 0) {
    return NextResponse.json({ blad: "Podaj 'posilki' — dzień do domknięcia" }, { status: 400 });
  }
  if (!req.celDnia || typeof req.celDnia.bialko !== "number") {
    return NextResponse.json({ blad: "Podaj 'celDnia' z makro dnia" }, { status: 400 });
  }

  try {
    const { posilki, dodaneBialko, powod } = domknijDzien(
      req.posilki,
      req.celDnia,
      zbudujFiltr(req.restrykcje ?? [], req.nielubiane ?? [])
    );

    if (dodaneBialko === 0) {
      return NextResponse.json({
        posilki: req.posilki,
        dodaneBialko: 0,
        komunikat: KOMUNIKATY[powod ?? "brak-miejsca"],
      });
    }

    // Domknięcie częściowe jest normalne i celowe (patrz domykanie.ts), ale skoro user kliknął
    // świadomie, ma prawo wiedzieć, że to jeszcze nie wszystko i dlaczego.
    return NextResponse.json({ posilki, dodaneBialko, komunikat: powod ? KOMUNIKATY[powod] : undefined });
  } catch (err) {
    return NextResponse.json({ blad: err instanceof Error ? err.message : "Nieznany błąd" }, { status: 400 });
  }
}
