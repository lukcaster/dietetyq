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

Darmowa instancja usypia po ~15 min bez ruchu, więc aplikacja **pinguje samą siebie**: [`instrumentation.ts`](instrumentation.ts) co 10 minut strzela do `/api/health`. Zmienną `RENDER_EXTERNAL_URL` wstrzykuje sam Render — lokalnie jej nie ma, więc na Twojej maszynie nic nie pinguje. W logach Rendera zobaczysz `[KeepAlive] aktywny → ...` przy starcie i `[KeepAlive] ping OK (200)` co dziesięć minut.

[`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml) został w roli **awaryjnej**: budzi instancję, która już zasnęła (śpiący proces nie wykona własnego `setInterval`).

Czego nauczyło nas pierwsze podejście:

- **GitHub Actions nie nadaje się na keep-alive co 10 minut.** Przy cronie ustawionym na `*/10` zmierzone odstępy między uruchomieniami wyniosły **140, 167, 179 i 308 minut** — GitHub dławi częste harmonogramy i pomija uruchomienia. Dlatego główny ping siedzi w aplikacji, a workflow chodzi rzadko i tylko jako ratunek.
- **Ciągłe budzenie zjada darmowe godziny instancji.** Render daje 750 h/miesiąc na konto, a serwis działający non stop bierze ~720. Na tę jedną aplikację wystarczy, na drugą darmową już nie.
- GitHub wyłącza zaplanowane workflow w repo bez aktywności przez 60 dni.
- `KEEPALIVE_MS` skraca interwał — wyłącznie po to, żeby dało się sprawdzić działanie bez czekania 10 minut.
