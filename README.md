# dietetyq

Planer posiłków pod cel kcal/makro: tygodniowy plan z przepisów, kreator własnego posiłku i tryb „z lodówki" (dzień rozpisany z tego, co masz). Mechanika silnika opisana w [SPEC.md](SPEC.md), backlog w [TODO.md](TODO.md).

## Lokalnie

```bash
npm install
npm run dev          # http://localhost:3000
npm run sprawdz-baze # walidacja data/*.json po edycji przepisów/składników
```

## Deploy (Render, plan darmowy)

Konfiguracja jest w [render.yaml](render.yaml): build `npm ci && npm run build`, start `npm run start`, Node 24.

1. Na [render.com](https://render.com) zaloguj się przez GitHuba.
2. **New → Blueprint**, wybierz to repo i zatwierdź — Render założy serwis `dietetyq`.
3. Po buildzie aplikacja jest pod `https://dietetyq.onrender.com` (albo podobnym adresem, jeśli nazwa jest zajęta).

Każdy push na `main` robi nowy deploy. Darmowy serwis usypia się po ~15 min bez ruchu — pierwsze wejście po przerwie ładuje się do minuty.

### Dlaczego nie ma keep-alive

Instancja usypia i **tak zostaje**. Przez jakiś czas apka pingowała samą siebie co 10 minut
(`instrumentation.ts`), a awaryjnie budził ją workflow GitHuba co 30 minut. Oba zostały usunięte,
bo lek był gorszy od choroby.

Render daje **750 godzin instancji na miesiąc na cały workspace**, nie na usługę — a miesiąc ma
720-744 godziny. Rachunek wychodzi tak:

| Co pinguje              | Ile instancja czuwa | Przy dwóch apkach |
| ----------------------- | ------------------- | ----------------- |
| nic (usypia po 15 min)  | tyle, ile ktoś używa | spokojnie w limicie |
| workflow co 30 min      | ~50% miesiąca, ~360 h | ~720 h, na styk     |
| ping z apki co 10 min   | non stop, ~730 h      | ~1460 h, 2x limit   |

Po wyczerpaniu puli Render **zawiesza wszystkie darmowe usługi do końca miesiąca**. Czyli ping
kupował brak minutowego zimnego startu za cenę tygodnia niedziałającej apki — zła wymiana.

Dwie rzeczy warte zapamiętania, gdyby temat wrócił:

- **Limit godzin jest na workspace, nie na usługę.** Druga darmowa apka dzieli tę samą pulę.
- **GitHub Actions nie nadaje się na keep-alive co 10 minut** i nigdy się nie nadawał. Przy cronie
  `*/10` zmierzone odstępy między uruchomieniami wyniosły **140, 167, 179 i 308 minut** — GitHub
  dławi częste harmonogramy. Dodatkowo wyłącza zaplanowane workflow w repo bez aktywności przez
  60 dni.

[`/api/health`](app/api/health/route.ts) zostaje — jest tani i przydaje się do sprawdzenia, czy
instancja żyje.
