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
