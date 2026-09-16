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

### Utrzymywanie serwisu przy życiu (keep-alive)

[`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml) pinguje `/api/health` co 10 minut. Żeby zadziałał, ustaw adres aplikacji w **Settings → Secrets and variables → Actions → Variables** jako `APP_URL` (np. `https://dietetyq.onrender.com`, bez ukośnika na końcu).

Zanim to włączysz, warto wiedzieć:

- **W prywatnym repo to nie zmieści się w darmowym limicie.** GitHub liczy każdy start joba jako minimum minutę, czyli ~4300 minut miesięcznie przy darmowych 2000. W publicznym repo Actions są darmowe bez limitu. W prywatnym repo lepiej zamiast tego użyć zewnętrznego pingera ([cron-job.org](https://cron-job.org), [UptimeRobot](https://uptimerobot.com)) — wtedy workflow można usunąć.
- **Ciągłe budzenie zjada darmowe godziny instancji.** Render daje 750 h/miesiąc na konto, a serwis działający non stop bierze ~720. Na tę jedną aplikację wystarczy, na drugą darmową już nie.
- **Harmonogram GitHuba bywa spóźniony** o kilkanaście minut, więc pojedyncze uśnięcie i tak się zdarzy.
- GitHub wyłącza zaplanowane workflow w repo bez aktywności przez 60 dni.
