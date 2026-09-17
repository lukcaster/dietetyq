/**
 * Kod uruchamiany raz przy starcie serwera (Next.js woła `register()` sam).
 *
 * Trzymamy tu keep-alive dla darmowego planu Rendera: serwis usypia po ~15 min bez ruchu,
 * a zimny start trwa do minuty.
 *
 * Wcześniej pingował to GitHub Actions i **to nie działało**: przy cronie ustawionym na co
 * 10 minut GitHub uruchamiał workflow co 140-308 minut (zmierzone na pięciu kolejnych
 * przebiegach), bo mocno dławi częste harmonogramy. Ping z wnętrza aplikacji jest dokładny
 * co do minuty i nic nie kosztuje.
 *
 * Czego ten mechanizm NIE potrafi: obudzić instancji, która już zasnęła — śpiący proces nie ma
 * jak wykonać własnego setInterval. Od tego jest zewnętrzny pinger (patrz .github/workflows),
 * który wystarczy, że zadziała raz na jakiś czas.
 */

/** 10 minut, bo Render usypia po ~15. `KEEPALIVE_MS` jest tylko po to, żeby dało się to sprawdzić bez czekania. */
const CO_ILE_MS = Number(process.env.KEEPALIVE_MS) || 10 * 60 * 1000;

export async function register() {
  // Next uruchamia instrumentację także dla edge runtime — tam nie ma setInterval ani sensu.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Zmienną wstrzykuje sam Render. Lokalnie jej nie ma, więc na Twojej maszynie nic nie pinguje.
  const adres = process.env.RENDER_EXTERNAL_URL;
  if (!adres) return;

  const cel = `${adres.replace(/\/$/, "")}/api/health`;
  const interwal = CO_ILE_MS >= 60000 ? `${Math.round(CO_ILE_MS / 60000)} min` : `${Math.round(CO_ILE_MS / 1000)} s`;
  console.log(`[KeepAlive] aktywny → pinguję ${cel} co ${interwal}`);

  const timer = setInterval(async () => {
    try {
      const odpowiedz = await fetch(cel, { cache: "no-store" });
      console.log(`[KeepAlive] ping ${odpowiedz.ok ? "OK" : "BŁĄD"} (${odpowiedz.status})`);
    } catch (blad) {
      // Nieudany ping nie może wywrócić serwera — najwyżej instancja uśnie.
      console.warn(`[KeepAlive] ping nieudany: ${blad instanceof Error ? blad.message : String(blad)}`);
    }
  }, CO_ILE_MS);

  // Timer nie ma trzymać procesu przy życiu sam z siebie.
  timer.unref?.();
}
