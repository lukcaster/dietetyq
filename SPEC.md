# Dietetyq — spec MVP

## Cel
Strona, na której user wypełnia formularz i dostaje gotowy plan jedzenia na tydzień (z różnorodnością dań, poprawnymi makro i przepisami które faktycznie chce się zjeść). Skala startowa: ja + parę znajomych, bez logowania.

## Zasady, których się trzymamy
- **Liczby (kcal/makro) liczy deterministyczny algorytm, nie LLM.** Model językowy nie jest źródłem prawdy dla matematyki.
- **Przepisy są kuratorowane ręcznie** (na start 30-50 sztuk), nie generowane/scrapowane automatycznie — to gwarancja, że nikt nie dostanie "zdrowego" dania, którego nie zje.
- **Prostota nad kompletność.** Każda funkcja ponad ten zakres czeka na osobną iterację.

## Stack
- **Next.js + TypeScript** — frontend i backend (API routes) w jednym projekcie.
- Logika "silnika" (dobór/skalowanie posiłków, liczenie makro) jako **osobny moduł** niezależny od Next.js, żeby dało się go później użyć z appki mobilnej (Expo) bez przepisywania.
- **Baza przepisów: pliki JSON w repo.** Zero infrastruktury bazodanowej na start.
- Hosting: Vercel (darmowy tier wystarcza na tę skalę).

## Dwie ścieżki
Na wejściu user wybiera, od której strony podchodzi do problemu. Kroki 1-2 (kcal/makro, wybór slotów) są wspólne, dalej ścieżki się rozjeżdżają:

| | **Dobierz mi przepisy** | **Mam składniki, rozpisz mi to** |
|---|---|---|
| punkt wyjścia | cel makro | cel makro **+ zawartość lodówki** |
| zakres | 7 dni | 1 dzień |
| wynik | dania z bazy + instrukcje + lista zakupów | co i ile zjeść w każdym slocie, bez przepisów |
| silnik | `planner.ts` | `z-lodowki.ts` + `solver.ts` |

Obie kończą się `PosilekWPlanie`, więc renderują się tymi samymi komponentami i liczą tak samo do makro dnia.

## Flow ścieżki „przepisy"
1. User wypełnia formularz (patrz niżej).
2. Backend liczy target kcal/makro, filtruje i dobiera przepisy z bazy JSON na 7 dni.
3. User widzi plan na stronie + może go ściągnąć jako PDF.
4. Jeśli chce inny wariant — generuje od nowa (brak zapisywania historii na MVP).

## Formularz — dane wejściowe

### Krok 1: cel kaloryczny/makro
- **Kcal dzienne** — wpisane wprost (pole liczbowe), to jest ścieżka domyślna/najprostsza.
- Opcjonalnie (rozwijane "Oblicz to za mnie" / zaawansowane):
  - waga, wzrost, wiek, płeć → BMR wg wzoru Mifflin-St Jeor
  - aktywność w pracy (1-4: siedząca → ciężka fizyczna) i wysiłek poza pracą (A-F: brak → ponad godzinę dziennie) → PAL wg wzoru `1.4 + (indeks_poza_pracą-1)*0.1 + (indeks_pracy-1)*0.1` (A.1=1.4 ... F.4=2.2), TDEE = BMR × PAL
  - cel: redukcja / utrzymanie / masa → modyfikator na TDEE (np. redukcja -15%)
- **Procentowy rozkład makro** (białko/tłuszcz/węgle) — ustawiany w kroku 1, domyślnie **30/35/35**, z presetami (wysokobiałkowe, mniej tłuszczu, więcej węgli) i walidacją sumy do 100% (tolerancja 1 pkt proc., bo 33/33/34 to sensowny rozkład).

To jest procent **kalorii**, nie gramów: `gramy = kcal * procent / 100 / kcalNaGram`, gdzie białko i węgle mają 4 kcal/g, a tłuszcz 9 kcal/g. Przy 2200 kcal i 30/35/35 wychodzi 165 g białka, 86 g tłuszczu, 192 g węgli. UI pokazuje te gramy na żywo przy wpisanych kcal, żeby nie trzeba było liczyć w głowie.

> Alternatywą, którą warto rozważyć później, jest liczenie białka **na kilogram masy ciała** (typowo 1,6–2,2 g/kg przy redukcji) zamiast jako % kalorii — przy niskich kcal procent potrafi dać za mało białka. Dane o wadze już mamy w ścieżce "wylicz dla mnie".

> Uwaga projektowa: kcal i % makro muszą być rozdzielone w UI od razu jako dwa niezależne pola, nawet jeśli na starcie tylko kcal jest wymagane — żeby nie trzeba było przebudowywać formularza później.

### Krok 2: posiłki
- User wybiera konkretne sloty posiłków z listy (multi-select), np.: śniadanie, II śniadanie, obiad, podwieczorek, kolacja.
- Backend dzieli dzienny target kcal/makro między wybrane sloty (proporcje do ustalenia przy implementacji silnika — np. śniadanie/kolacja mniejsze, obiad największy).

### Krok 2b: charakter posiłku (na tym samym ekranie co sloty)
Dla każdego zaznaczonego slotu user wybiera `charakter`: **słodkie / wytrawne / bez znaczenia** (domyślnie bez znaczenia) — np. śniadania zawsze na słodko, kolacje wytrawne. Trafia do silnika jako `charakterPerSlot`; brak wpisu = pełna pula przepisów dla tego slotu.

### Krok 3: restrykcje
- Checkboxy z najczęstszymi: laktoza, gluten, orzechy, jajka, ryby/owoce morza, mięso (wege), soja.
- Dodatkowo wolne pole tekstowe na coś nietypowego (na MVP może być tylko informacyjne/nieparsowane automatycznie — patrz "Poza zakresem").
- Zaznaczona restrykcja → silnik filtruje przepisy bez tagu danego alergenu **lub** podstawia zamiennik składnika (patrz niżej), jeśli przepis na to pozwala.

### Krok 4: lubiane i nielubiane składniki
Lista składników pogrupowana tematycznie (mięso, nabiał, zboża, warzywa, owoce, roślinne), z trzystanowym przełącznikiem na każdym: neutralnie → **lubię** → **nie jem tego** → neutralnie. Krok jest w całości opcjonalny.

Dwa rodzaje preferencji działają celowo inaczej:
- **nielubiane — twardo, jak restrykcja.** Ten sam mechanizm co alergen (`FiltrSkladnikow` w `macro.ts`): grupa wyboru podstawia zamiennik, a przepis bez wyjścia wypada z puli. Różni się tylko dopasowaniem — alergen po `tagiAlergenow`, nielubiany po `id` składnika.
- **lubiane — miękko, jako ranking.** Ocena przepisu = ile lubianych składników zawiera; przy równej ocenie decyduje losowanie. Gdyby działało twardo, przy trzech zaznaczonych składnikach zostałyby dwa przepisy na cały tydzień.

Wykluczenie może zabić całą pulę dla slotu (np. ktoś odznaczy jajko, płatki i nabiał, a zostaje mu jedno śniadanie). Silnik **nie pomija wtedy slotu po cichu** — zwraca `ostrzezenia[]`, a UI pokazuje je nad planem.

Które składniki w ogóle pojawiają się na tej liście, decyduje pole `grupaPreferencji` w `ingredients.json` (patrz niżej) — nie hardkod w UI.

## Model danych — dwa pliki

### `data/ingredients.json` — jedno źródło prawdy na składnik
Każdy składnik: `id`, `nazwa`, `makroNa100g { kcal, bialko, tluszcz, wegle }`, `tagiAlergenow[]`.
Dzięki temu makro poprawiamy w jednym miejscu, a nie w każdym przepisie z osobna. Dla generycznych surowców (kasze, mięso, jajka) wpisujemy wartości ze znanych tabel odżywczych; dla konkretnych produktów markowych można pociągnąć dane z **Open Food Facts** (darmowe publiczne API, bez klucza, query po nazwie/kodzie kreskowym).

Dla składników liczonych "na sztuki" (jajko, ewentualnie owoce) dodajemy opcjonalne `masaSztuki` (g) — przeciętna gramatura jednej sztuki. Wtedy w przepisie `jednostka` może być `"szt"`, a silnik przelicza `ilosc * masaSztuki / 100 * makroNa100g` żeby dostać makro. Bez tego nikt nie waży jajka na wagę kuchenną.

Opcjonalne pole `rolaKulinarna` (np. `"pieczywo"`, `"wedlina"`, `"owoc"`) mówi, do jakiego **gniazda w szablonie dania** składnik może wejść — patrz `data/szablony.json` i sekcja o trybie „z lodówki". To inna oś niż `kategoria`: `kategoria` odpowiada na „czym to podmienić w tym przepisie", `rolaKulinarna` na „jaką funkcję to pełni na talerzu". Brak pola = składnik nie tworzy posiłku sam z siebie (mąka, drożdże, cytryna).

Dwa opcjonalne pola opisują **wielkość porcji**, w gramach, niezależnie od tego, w jakiej jednostce składnik siedzi w koszyku:

- `porcjaTypowa` — ile tego człowiek normalnie nakłada sobie na talerz. To nie jest ani minimum, ani maksimum, tylko punkt, ku któremu ciąży solver, gdy makro mu na to pozwala (`WAGA_TYPOWEJ_PORCJI` w `solver.ts`). Bez tego pola funkcja celu jest **płaska** w kierunku składników obojętnych dla makro — 100 g ogórka to 12 kcal i zero białka — więc solver lądował na losowym krańcu przedziału i wychodziło 200 g ogórka w kanapce albo 15 g borówek przy 250 g w koszyku.
- `maksPorcja` — twardy sufit na jedną porcję, **nadpisujący** sufit wynikający z roli kulinarnej. Ustawiamy go tylko tam, gdzie rola kłamie: cebula ma rolę `"warzywo"` (żeby trafiać do gniazd na warzywa) i przez to sufit 200 g, ale 135 g cebuli w daniu to nie porcja warzyw, tylko pomyłka. W przeciwieństwie do sufitu z roli **nie skaluje się** z wielkością posiłku — 60 g cebuli to 60 g cebuli niezależnie od tego, jak duży jest obiad.

Opcjonalne pole `grupaPreferencji` (np. `"Mięso i wędliny"`) wystawia składnik na liście „lubię / nie jem tego" w kroku 4 i decyduje, pod jakim nagłówkiem się pojawi. Ustawiamy je **tylko dla składników, o które ma sens zapytać** — erytrytol, drożdże czy mąka ryżowa to detal przepisu, nie preferencja, więc pola nie mają i lista ich nie pokazuje. Kolejność grup i pozycji w nich bierze się z kolejności wpisów w pliku.

Składnik może też mieć opcjonalne pole `kategoria` (np. `"mleko"`, `"jogurt"`, `"platki-owsiane"`, `"baza-bialkowa-kremowa"`) — łączy składniki, które mogą zastąpić się nawzajem w przepisie (patrz grupa wyboru niżej). To jest **jedyne miejsce**, gdzie definiujemy "co jest zamiennikiem czego" — dodanie nowego mleka do bazy z tą samą kategorią automatycznie odblokowuje je we wszystkich przepisach używających tej kategorii, bez dotykania ich danych.

### Sprawdzarka bazy (`scripts/sprawdz-baze.mjs`)

`npm run sprawdz-baze` — odpalana ręcznie po każdej zmianie w `data/`. Nie importuje silnika (tamten kod jest w TS i zakłada Next.js), więc da się ją puścić gołym `node` w dowolnym momencie.

**Błędy** (kod wyjścia 1): odwołanie do nieistniejącego składnika lub komponentu, pusta kategoria zamienników, domyślny składnik spoza swojej kategorii, `"szt"` przy składniku bez `masaSztuki`, nieznany slot/charakter, zduplikowane id, `wymaganeDodatki` bez ani jednego pasującego przepisu, oraz rozjazd zsumowanych kcal z 4/9/4 na B/T/W powyżej 12%.

**Ostrzeżenia**: brak `mikroNa100g`, rola kulinarna bez `porcjaTypowa`, `porcjaTypowa` większa od `maksPorcja`, powtórzona nazwa przepisu, składniki nieużywane w żadnym przepisie.

**Pokrywające się przepisy** — podobieństwo liczone jako suma `min(udziałA, udziałB)` po wspólnych składnikach, gdzie udział to ułamek masy przepisu. Ważenie masą jest tu istotne: dwa dania dzielące jajko i mąkę są różne, jeśli jedno w 60% składa się z kurczaka, a zwykły Jaccard na zbiorach id-ków tego nie odróżnia. Grupa wyboru liczy się jako swoja **kategoria**, nie jako domyślny składnik, żeby dwa przepisy „na dowolnej mące" wykrywały się nawzajem.

Kontrola kcal uwzględnia, że w `wegle` siedzą węglowodany ogółem razem z błonnikiem, a błonnik daje ok. 2 kcal/g (tak liczy rozporządzenie UE 1169/2011). Obok progu procentowego jest próg bezwzględny 15 kcal — przy ogórku (12 kcal/100 g) różnica 4 kcal to 33% i sam szum zaokrągleń z tabel, a przy mące ta sama różnica procentowa byłaby realną literówką. Trzy składniki są z kontroli wyjęte na stałe, z uzasadnieniem w kodzie: kakao, proszek do pieczenia i ocet ryżowy.

`--przepis=<fragment id>` wypisuje jeden przepis składnik po składniku z kcal każdej pozycji i rozkładem makro na porcję — do sprawdzania, czy nowy wpis trafia w zakładane wartości. `--strict` traktuje ostrzeżenia jak błędy (do CI), `--prog=0.5` zmienia czułość wykrywania duplikatów.

### `data/recipes.json` — przepisy odwołujące się do składników po id
Każdy przepis: `id`, `nazwa`, `slot[]` (śniadanie/obiad/...), `charakter` (`slodkie` / `wytrawne`), `porcje` (na ile porcji wychodzi cały przepis — np. owsianka to 1, ale sernik czy garnek zupy to więcej), `instrukcje: string[]` (realne kroki przygotowania, tekstem).

`porcje` jest konieczne, żeby silnik mógł podzielić makro całego przepisu na "1 porcję" i dalej przeskalować ją do indywidualnego targetu kcal/makro usera dla danego posiłku: `makroNaPorcje = makroCalegoPrzepisu / porcje`, a finalne skalowanie = `makroNaPorcje * (targetUsera / makroNaPorcje.kcal)`.

Czas dzielimy na dwa pola, bo to różne rzeczy dla planowania:
- `czasPrzygotowania` (`<15` / `15-30` / `30+`) — czas **aktywny**, ile faktycznie trzeba stać i robić.
- `czasOczekiwania` (opcjonalne, np. `"noc"`, `"2h"`) — czas **pasywny** (lodówka, marynowanie, pieczenie). Jeśli ustawione, UI/PDF musi pokazać ostrzeżenie typu "przygotuj wcześniej", a algorytm planu powinien unikać wsadzania takiego przepisu w dzień, w którym user nie miał szansy go przygotować z wyprzedzeniem (np. nie proponować "nocnego chia" na śniadanie pierwszego dnia planu bez wyraźnego zaznaczenia, że user je już ma zrobione).

`skladniki` to lista pozycji dwóch typów:
- **zwykła**: `{ skladnikId, ilosc, jednostka }` — jeden konkretny składnik, bez zamiennika. Jeśli ma zakazany alergen, cały przepis wypada (chyba że to akurat ten przepis, który z definicji jest np. tylko mleczny).
- **grupa wyboru**: `{ nazwaGrupy, ilosc, jednostka, kategoria, domyslnaSkladnikId }` — gdy dany składnik ma sensowne alternatywy. `kategoria` wskazuje, z jakiej puli składników (pole `kategoria` w `ingredients.json`) silnik może wybierać, a `domyslnaSkladnikId` to wybór *tego konkretnego przepisu* w sytuacji, gdy nic nie jest zakazane (np. sernik wybiera domyślnie twaróg, a keksówka skyr — mimo że oba są w tej samej kategorii `baza-bialkowa-kremowa`). Gdy user zaznaczy restrykcję, silnik filtruje kategorię do dopuszczalnych składników i wybiera spośród nich (domyślny, jeśli przeszedł filtr, inaczej pierwszy pozostały); jeśli żaden nie przejdzie — przepis jest niewykonalny.

Każdy przepis musi być świadomie zaprojektowany pod kątem zamienników — dodanie nowego składnika do kategorii nie naprawia automatycznie przepisów, które używały starego składnika jako pozycji "zwykłej" (bez grupy). To zamierzone: decyzja "czy tu da się sensownie podstawić coś innego" należy do autora przepisu, nie do automatu (np. mąka pszenna w cieście na pierogi to inna technika, nie prosty zamiennik 1:1 — wymaga osobnego komponentu, nie grupy wyboru w tej samej kategorii).

Makro przepisu nigdy nie jest wpisane na sztywno — liczone jest w runtime jako suma `ilosc/100 * makroNa100g` wybranych składników, więc zamiana opcji w grupie automatycznie przelicza wynik.

Przykład — zobacz [data/ingredients.json](data/ingredients.json) i [data/recipes.json](data/recipes.json) (owsianka z grupami wyboru na mleko i owoc).

### `data/components.json` — wspólne pół-przepisy (np. ciasto)
Gdy kilka przepisów współdzieli identyczny, wieloskładnikowy element (np. ciasto pierogowe użyte w 3 różnych farszach), nie duplikujemy go w każdym przepisie — definiujemy raz jako komponent: `id`, `nazwa`, `iloscWynikowa` + `jednostkaWynikowa` (ile wychodzi z podanych proporcji), `skladniki` (jak w przepisie, realne `ingredients.json`), `instrukcje` (jak go przygotować).

Przepis odwołuje się do komponentu jak do składnika: `{ komponentId, ilosc, jednostka }`. Makro liczone proporcjonalnie: `(ilosc / iloscWynikowa) * suma_makro_skladnikow_komponentu`. Dzięki temu zmiana proporcji ciasta w jednym miejscu przelicza się automatycznie we wszystkich przepisach, które go używają.

Przykład — [data/components.json](data/components.json) (ciasto pierogowe) używane w 3 wariantach pierogów w [data/recipes.json](data/recipes.json).

### Dodatki do dania głównego (`kategoriaDania`, `wymaganeDodatki`)
Przepis może mieć `kategoriaDania`: `"glowne"` (domyślne, gdy pole nie jest podane), `"dodatek-skrobiowy"` (ryż/ziemniaki/kasza/frytki) albo `"surowka"`. Dodatki to zwykłe przepisy — z `instrukcje`, `skladniki` itd. — tylko oznaczone tą kategorią, żeby silnik nie proponował ich jako samodzielnego dania.

Danie główne dostaje `wymaganeDodatki: ("dodatek-skrobiowy" | "surowka")[]`, jeśli **samo nie jest kompletnym posiłkiem**. Silnik dobiera po jednym przepisie z każdej wymaganej kategorii (z taką samą logiką unikania powtórek jak przy głównych daniach) i dzieli kcal/makro posiłku między danie główne i dodatki.

**Zasada przy dodawaniu nowego dania głównego (pamiętać na przyszłość)**: zawsze sprawdzić, czy przepis już zawiera źródło węglowodanów (ciasto, tortilla, ryż w środku itp.) i/lub warzywo. Jeśli nie — dopisać `wymaganeDodatki`. Przykład: kotlety mielone i nuggetsy (samo białko) mają `["dodatek-skrobiowy", "surowka"]`; pierogi (ciasto + farsz to już kompletny posiłek) i tortilla pizza nie potrzebują żadnych dodatków.

### `data/produkty.json` — produkty sklepowe z Open Food Facts
Warstwa **osobna od `ingredients.json`** i celowo nietykana przez przepisy: kilka tysięcy konkretnych produktów z półki (marka + kod kreskowy), zaimportowanych z Open Food Facts skryptem `scripts/import-off.mjs`. Służą wyłącznie kreatorowi własnego posiłku — user chce wybrać „skyr Piątnica", a nie generyczny „skyr".

Podział na dwie warstwy wynika z różnicy w zaufaniu do danych:
- `ingredients.json` — kuratorowane ręcznie, pewne makro, pełne tagi alergenów. Tylko z tego budowane są przepisy.
- `produkty.json` — dane crowdsourcowane. Import odrzuca produkty bez kompletnego makro oraz takie, gdzie `4*B + 9*T + 4*W` rozjeżdża się z deklarowanymi kcal o ponad 30% (typowy błąd w OFF: wartości podane na porcję zamiast na 100 g).

**Alergeny w OFF bywają nieuzupełnione i brak tagu NIE znaczy „bezpieczny".** Dlatego każdy produkt ma flagę `alergenyNieznane`, a wyszukiwarka przy aktywnych restrykcjach domyślnie takie produkty ukrywa (`dopuscNieznaneAlergeny` je odblokowuje, ale wtedy kreator dokłada ostrzeżenie „sprawdź opakowanie").

Import nie działa w runtime — uruchamiamy go ręcznie, a wynik wchodzi do repo jak każdy inny plik z danymi:
```
node scripts/import-off.mjs --strony=80 --rozmiar=100
```
Zapytanie zawęża się do `countries_tags:"en:poland" AND lang:pl` — sam filtr po kraju daje głównie międzynarodowe słodycze z obcojęzycznymi nazwami, bo to one mają najwięcej skanów. Aplikacja działa bez tego pliku (kreator ma wtedy tylko kuratorowaną bazę).

Id ze spiżarni niesie źródło: składnik bazowy ma zwykłe id (`kurczak-piers`), produkt z OFF prefiks `off:` (`off:5900512300108`). Wspólny widok na oba źródła daje `lib/engine/spizarnia.ts`.

## Algorytm doboru planu (silnik)
1. Policz target kcal/makro na dzień → rozbij na sloty.
2. Dla każdego slotu/dnia: odfiltruj przepisy niespełniające restrykcji **ani nielubianych składników** (chyba że da się zastosować zamiennik) oraz — jeśli slot ma ustawiony `charakter` — o innym charakterze.
3. Dobierz przepis najbliższy targetowi kcal/makro dla danego slotu (skalowanie porcji jeśli przepis to wspiera).
4. Pilnuj różnorodności — unikaj powtórzenia tego samego przepisu w tym samym tygodniu, jeśli pula przepisów to umożliwia (fallback: dopuszczamy powtórkę, jeśli pula jest za mała, niż wymuszać złe dopasowanie kalorii).
5. Zwróć plan: 7 dni × wybrane sloty, z finalnym makro/kcal per posiłek i per dzień.

**Wybór spośród kandydatów jest losowy, nie „pierwszy z brzegu".** `wybierzKandydata` zawęża pulę (nieużyte w tygodniu → nieużyte dzisiaj → wszystko), ocenia ją liczbą lubianych składników i **losuje spośród najlepiej ocenionych**. Losowanie jest tu wymogiem, nie ozdobnikiem: przy deterministycznym „weź pierwszy" plan zawsze składał się z pierwszych N przepisów w kolejności zapisu w `recipes.json`, a dalsza część bazy nie wypadała nigdy (mierzone: 7 unikalnych dań na tydzień przy 35 przepisach w bazie; po zmianie 16–19).

## Tryb „z lodówki" (`lib/engine/z-lodowki.ts`)
Proces odwrócony względem planera. Planer idzie *cel → przepisy → składniki*; tutaj user podaje cel makro **i koszyk tego, co ma** (albo na co ma ochotę), a silnik odpowiada, co i ile zjeść w którym slocie. Zakres to **jeden dzień** — lodówka nie starcza na tydzień, a rozmnażanie koszyka na 7 dni dawałoby siedem identycznych dni.

Świadomie **nie ma tu żadnych przepisów ani instrukcji przygotowania**. Wynikiem jest odpowiedź na „co zjeść", nie na „jak to ugotować" — to jest cała różnica względem drugiej ścieżki.

Pozycja koszyka to `{ id, jednostka, dostepneIlosc? }`. Brak `dostepneIlosc` znaczy „mam dość, dobierz ile trzeba". Podana ilość jest **twardym limitem na cały dzień**: dzielimy ją równo między sloty, do których składnik trafił, więc suma po dniu nigdy nie przekroczy zapasu. Co zostaje, wraca jako `resztki[]`.

### Jak powstaje posiłek — najpierw przepis, szablon dopiero w zastępstwie
Na każdy slot silnik szuka **przepisu z `recipes.json`, który da się zrobić z tego, co user ma**. Sprawdzane są wszystkie składniki: pozycje zwykłe muszą być w koszyku, grupy wyboru rozwiązujemy **pod dostępność** (masz mąkę owsianą zamiast pszennej → naleśniki idą na owsianej), a komponenty wymagają kompletu surowców. Brakuje czegokolwiek — przepis odpada, bo przepisu nie da się zrobić „prawie".

Wybrany przepis skalujemy **jednym mnożnikiem do całości**, nigdy solverem: proporcje są częścią przepisu i nie wolno dosypać mąki, zostawiając jajka. Mnożnik przycinamy zadeklarowanym zapasem. Do posiłku trafiają oryginalne `instrukcje` — o to w tym trybie chodzi.

**Szablony (`data/szablony.json`) są fallbackiem**: wchodzą, gdy z koszyka nie da się zrobić żadnego przepisu, ale da się zjeść sensowny posiłek. Dostają solver do gramatur i nie mają instrukcji. Przepis ma w ocenie stały bonus, więc przy zbliżonym dopasowaniu zawsze wygrywa.

#### Dopasowanie makro jest wskazówką, nie wyrocznią
Waga rozjazdu od celu jest celowo **niska** (`WAGA_ROZJAZDU = 1/6`), a spośród kandydatów w promieniu 10 punktów od najlepszego **losujemy**. Powód jest wprost produktowy: przy mocnym trzymaniu makra wygrywały zawsze te same 2-3 zestawy, które akurat idealnie trafiały w cel, a reszta bazy nie wypadała nigdy. Ktoś, kto je z apetytem sensowne dania, wyjdzie na tym lepiej niż ktoś, komu silnik wcisnął idealnie policzoną potrawę, której nie tknie — jeden dzień z białkiem na poziomie 85% normy to nie jest problem.

Zmierzone na koszyku 11 składników, 8 przebiegów: **88% posiłków pochodzi z przepisu**, 6 różnych dań, kcal 2224/2200, białko 139/165 (84%), średnio 1,9 niewykorzystanego składnika.

Progi ostrzeżeń są z tego samego powodu luźne i **różne dla przepisu i szablonu**: przy szablonie mówimy od 20%, bo dorzucenie składnika realnie pomaga; przy przepisie dopiero od 40% i spokojniejszym tonem, bo rozjazd jest tam naturalny i nie do naprawienia inaczej niż zmianą dania. Ostrzeganie przy każdym daniu byłoby szumem, przez który user przestałby czytać ostrzeżenia w ogóle.

Gramatury przepisu zaokrąglamy „kuchennie" (`zaokraglijKuchennie`): poniżej 10 g do grama, do 100 g co 5 g, powyżej co 10 g. „19,3 g mąki" jest formalnie dokładniejsze, ale nikt tego nie odważy — a przy przepisie skalowanym w całości ta dokładność i tak jest pozorna.

### Szablony dań (fallback)
Sercem fallbacku jest `data/szablony.json`: lista archetypów dania z **gniazdami na role kulinarne**, nie na konkretne składniki. Kanapka to `pieczywo + (wedlina|ser|jajko|baza-kremowa) + [warzywo] + [sos]`, danie na ciepło to `(mieso|jajko|ser) + (kasza-ryz|ziemniaki) + [warzywo] + [tluszcz] + [sos]`. Jeden szablon pokrywa setki kombinacji, a jednocześnie odcina bzdury: **nie ma szablonu, w którym szynka stoi obok ryżu z mlekiem, więc takie danie nie powstanie.**

Role kulinarne siedzą w `ingredients.json` w polu `rolaKulinarna` (`pieczywo`, `tortilla`, `wedlina`, `mieso`, `jajko`, `ser`, `baza-kremowa`, `jogurt`, `mleko`, `platki`, `kasza-ryz`, `ziemniaki`, `warzywo`, `owoc`, `dodatek-slodki`, `posypka`, `tluszcz`, `sos`, `odzywka`). To **trzecia, niezależna oś** obok `kategoria` (zamienniki 1:1 w przepisie) i `grupaPreferencji` (lista lubię/nie lubię) — nie mieszać. Mąki, drożdże i cytryna świadomie roli nie mają: nie tworzą posiłku same z siebie. Tortilla ma własną rolę, osobną od pieczywa, bo wrap z chleba to nie wrap.

> **Dlaczego nie dało się prościej.** Wcześniejsze podejście opisywało **pojedyncze składniki** (rola z makro + powinowactwo do slotu + osobno słodkie/wytrawne liczone per slot) i zostało w całości wyrzucone. Problem jest z natury **parami**: szynka i ryż każde z osobna są wytrawne i pasują do obiadu — dopiero razem są nonsensem. Żadna liczba właściwości pojedynczego składnika tego nie wyłapie. Trzy heurystyki zastąpił jeden mechanizm.

Algorytm na slot:
1. **Znajdź wykonalne szablony** — te, które obsługują dany slot i mają czym wypełnić wszystkie gniazda *wymagane*. Gniazda opcjonalne dobierane są w miarę dostępności; `ile` mówi, ilu składników najwyżej (np. 3 warzywa do sałatki).
2. **Przepuść każdego kandydata przez solver i wybierz najlepszego.** Sam fakt, że danie da się złożyć, nie znaczy, że pasuje na ten posiłek — owsianka z płatków i mleka nie dobije 52 g białka na śniadaniu. Rozjazd od celu jest **głównym** składnikiem oceny; premia za zużycie jeszcze nieużytych produktów, za pełniejsze danie i kara za powtórzenie tego samego szablonu w ciągu dnia rozstrzygają remisy.
3. **Solver gramatur** (ten sam `solver.ts`, co w kreatorze), z sufitami per rola kulinarna (pieczywo 150 g, wędlina 100 g, mięso 250 g, ser 60 g, kasza/ryż 120 g na sucho, tłuszcz 25 g…). Sufity **skalują się z celem slotu** — 250 g mięsa jest sensowne na obiad 600 kcal, ale nie na 1200 kcal — z mnożnikiem przyciętym do [0,6; 2,0]. Bez sufitów solver dobija kcal czym popadnie i wychodzi 400 g ogórka. Sufit jest zaokrąglany w dół do kroku jednostki, inaczej solver opiera się o limit i zwraca „455,33 g mleka".
4. **Usuwanie okruchów** — solver, dostrajając cztery cele naraz, potrafi zostawić 5 g pomidora albo 10 g szynki. Takie pozycje wypadają z zestawu i posiłek liczony jest jeszcze raz, żeby resztę rozłożyć na nowo. Składniki z gniazd **wymaganych** są przed tym chronione i mają gwarantowane minimum: owsianka bez płatków przestałaby być owsianką.

### Podstawowe zapasy (`zawszeWDomu`)
Olej i oliwa mają w `ingredients.json` flagę `zawszeWDomu: true` i silnik **dokłada je do koszyka sam**, o ile user ich nie dodał. Powód jest praktyczny: nikt nie wpisuje oleju do lodówki, bo każdy go ma — a bez niego szablon jajecznicy wypełniał tylko te gniazda, które dało się wypełnić, i zwracał samo jajko ze szpinakiem.

Konsekwencje w silniku:
- Nie mają `dostepneIlosc`, więc ogranicza je wyłącznie sufit kulinarny (25 g × mnożnik).
- Nie liczą się do premii za „świeże produkty" przy wyborze szablonu — inaczej dania z gniazdem tłuszczu wygrywałyby tylko dlatego, że jest czym je wypełnić.
- Nie trafiają do `resztki[]` ani do ostrzeżenia „nie weszły do planu" — user o nie nie prosił.

Powiązana zmiana w szablonach: w daniach smażonych i duszonych (`jajka-na-cieplo`, `danie-na-cieplo`, `mieso-z-warzywami`) gniazdo tłuszczu jest **wymagane**, nie opcjonalne. Gdy było opcjonalne, solver schodził z olejem poniżej progu sensownej porcji i „usuwanie okruchów" wyrzucało go z listy — dokładnie tak powstawała jajecznica bez tłuszczu.

### Wybór składników (picker spiżarni)
Koszyk buduje się **klikając kafelki na półkach**, nie wpisując nazwy: 59 składników w 7 kategoriach (Pieczywo, Mięso i wędliny, Nabiał i jaja, Kasze/ryż/płatki, Warzywa, Owoce, Dodatki). Wyszukiwarka zostaje pod półkami, ale tylko do tego, czego na nich nie ma — czyli produktów sklepowych z Open Food Facts. Sama wyszukiwarka była złym punktem wyjścia, bo wymagała, żeby user z góry wiedział, czego szuka.

Kategorie powstają z `rolaKulinarna`, a nie z `grupaPreferencji`: ta druga świadomie pomija odżywki białkowe, sosy i warianty smakowe, a one wypełniają gniazda szablonów, więc w lodówce muszą być widoczne (49 składników vs 59).

### Ręczna korekta gramatur
Każda gramatura w gotowym dniu jest edytowalna. User wpisuje ilość, na której mu zależy („chcę 300 g piersi"), a solver przelicza **resztę składników tego posiłku** pod cel makro slotu. Wpisana wartość zostaje **przypięta** (🔒) i solver już jej nie rusza, dopóki user jej nie odepnie; przypiętych może być wiele naraz.

Kilka decyzji, które warto znać:
- **Skład posiłku się nie zmienia** — nie dobieramy nowego szablonu ani nowych składników. To poprawka konkretnego dania, które user ma przed oczami, a nie nowy plan.
- **Przypięta wartość obowiązuje nawet ponad sufit kulinarny.** Jak ktoś chce 900 g piersi, to dostanie 900 g — ale też ostrzeżenie „o 236% za dużo białka, brakuje 83% węglowodanów". Silnik nie poprawia usera po cichu ani nie odmawia.
- **Składniki nieprzypięte mają minimum sensownej porcji**, żeby po korekcie jednej liczby reszta nie schodziła do zera i danie nie znikało z listy.
- Przeliczanie leci na `onBlur`, nie na `onChange` — inaczej byłoby jedno zapytanie na wciśnięty klawisz i liczby skakałyby pod palcami.

Silnik dzieli tu kod z planowaniem dnia (`granicePozycji`), więc po ręcznej korekcie obowiązują dokładnie te same sufity co przy pierwszym rozpisaniu.

Zapas z pola `dostepneIlosc` jest twardym limitem na cały dzień — dzielimy go równo między posiłki, do których składnik trafił, więc suma nigdy nie przekroczy tego, co user ma. Co zostało, wraca jako `resztki[]`.

Produkty z Open Food Facts nie mają roli kulinarnej (nikt nie otagował 4800 pozycji), więc nie mogą wypełnić gniazda. Nie wyrzucamy ich jednak z koszyka — user dodał je świadomie — tylko dokładamy jako uzupełnienie do posiłków, mówiąc wprost, że akurat tego nie potrafimy ocenić.

### „Dokup i zrobisz" (`lib/engine/propozycje-dokupienia.ts`)
Plan dnia bierze tylko przepisy wykonalne w 100% — ale ktoś, kto ma jajka i mleko, a nie ma mąki, jest o jedną rzecz od naleśników. Dlatego odpowiedź `/api/z-lodowki` ma pole `propozycje`: dla każdego przepisu głównego pasującego do wybranych slotów liczymy, co user **ma**, a czego **brakuje** (grupy wyboru spełnia dowolny składnik z kategorii, komponenty rozbijamy na surowce, powtórzony składnik liczy się raz).

- Składniki `zawszeWDomu` (olej, woda…) nie wchodzą ani do braków, ani do licznika „brakuje X/Y" — „dokup wodę" byłoby żartem, a zawyżone Y udawałoby, że user ma więcej.
- Odpadają przepisy wykonalne (są już w puli planu) i takie, z których **nic** nie ma w koszyku (to nie jest „z lodówki", tylko zwykły przepis z bazy).
- Przy restrykcjach nie podpowiadamy zakupu zakazanego składnika: z grupy bierzemy dozwolony zamiennik, a zwykły zakazany składnik wyrzuca przepis z propozycji.
- `wszystkie` są posortowane od najmniejszych braków. `wyroznione` to 2-3 id losowane **z wagą 1/braki²** spośród przepisów, w których brakuje najwyżej połowy składników — czysty ranking dawałby te same trzy podpowiedzi przy każdym przeliczeniu, czyste losowanie „dokup cztery rzeczy" obok „dokup jedną".
- Ilości braków są na cały przepis (na `porcje` porcji), bez skalowania i bez makro — to podpowiedź zakupowa, nie posiłek w planie.

W UI (`app/PropozycjeDokupienia.tsx`) wyróżnione idą jako karty „Dokup: X → zrobisz Y", a pod nimi rozwijana lista wszystkich przepisów ze znacznikiem „brakuje 4/5"; każdy przepis rozwija się do listy masz/brakuje (z zamiennikami) i instrukcji.

Silnik nigdy nie udaje, że trafił. Jako `ostrzezenia[]` wracają: slot, na który nie dało się złożyć żadnego dania; składniki, które nie weszły do planu; produkty dołożone „w ciemno"; oraz nieosiągalny cel — z rozbiciem na to, **czego** brakuje („brakuje 47% białka, o 35% za dużo węglowodanów"), a nie samym „rozjazd 47%".

## Bilans mikroskładników (`lib/engine/mikro.ts`)
Osiem pozycji liczonych dla każdego dnia: **błonnik, żelazo, wapń, magnez, potas, cynk, witamina C, sód**. Widoczne w obu ścieżkach — w planie tygodniowym jako średnia z 7 dni, w trybie „z lodówki" dla tego jednego dnia.

**Kluczowa zasada: mikro jest warstwą raportującą, nie optymalizacyjną.** Solver dobiera gramatury po czterech celach z `Makro` (`solver.ts`) i mikroskładniki celowo tam nie wchodzą — gdyby żelazo stało się piątym celem, solver zacząłby dosypywać szpinak do każdego posiłku, żeby dobić normę, dokładnie tak jak wcześniej dosypywał ogórka do kcal. Liczymy po fakcie i pokazujemy, a decyzję zostawiamy userowi.

Bilans liczy się ze `skladnikiBazowe` — tej samej postaci, z której powstaje lista zakupów (komponenty rozbite na surowce) — więc działa identycznie dla przepisów, dla trybu „z lodówki" i dla posiłków złożonych ręcznie w kreatorze.

Dwie rzeczy pilnują, żeby liczby nie kłamały:
- **`pokrycieMasy`** — jaki ułamek masy jedzenia dało się w ogóle policzyć. Produkty z Open Food Facts nie mają danych o mikroskładnikach, więc bez tego „brakuje ci 40% żelaza" byłoby zmyśleniem; to jest dolne oszacowanie, nie pomiar. Poniżej 60% pokrycia UI nie pokazuje liczb, tylko mówi, że nie ma z czego liczyć, i wymienia brakujące pozycje. To ten sam mechanizm co flaga `alergenyNieznane`.
- **Liczba złych dni zamiast samej średniej** — „średnio 79% błonnika" ukrywa, że w czterech dniach z siedmiu było go realnie za mało. UI pokazuje jedno i drugie.

Sód jest **limitem**, nie normą (`typ: "limit"`) — przekroczenie 2000 mg to problem, a nie sukces. Normy są podane dla dorosłej osoby wg płci; płeć bierzemy z formularza tylko w ścieżce „wylicz dla mnie", w pozostałych przypadkach domyślnie męskie i UI to pisze wprost.

### Skąd dane
`ingredients.json` ma `mikroNa100g` dla wszystkich 65 składników — **kuratorowane ręcznie z tabel wartości odżywczych**, dokładnie tak samo jak makro (patrz wyżej). To pierwsze przybliżenie, nie pomiar.

Do weryfikacji służy `scripts/import-mikro.mjs`, który porównuje je z **USDA FoodData Central** (jedyne darmowe źródło z porządnym pokryciem mikroskładników dla surowców generycznych) i opcjonalnie nadpisuje:
```
node scripts/import-mikro.mjs --klucz=TWOJ_KLUCZ            # raport różnic
node scripts/import-mikro.mjs --klucz=TWOJ_KLUCZ --zapisz   # nadpisanie
```
Klucz jest darmowy; `DEMO_KEY` ma limit ~8 zapytań na godzinę, więc na 65 składników się nie nadaje. Mapowanie id → fraza USDA jest **ręczne i niepełne**: świadomie nie dopasowujemy po nazwie tego, co odpowiednika nie ma (mleko A2, odżywki białkowe, skyr smakowy) — dopasowanie na ślepo wstawiłoby dane losowego produktu. Skrypt nie przelicza też jednostek: gdy USDA poda inną niż oczekiwana, zgłasza i pomija, zamiast ryzykować wartość 1000× za dużą.

## Kreator własnego posiłku (`lib/engine/kreator.ts`)
Druga ścieżka obok gotowych przepisów — dla kogoś, kto nie chce przepisu, tylko mówi „dziś smażony kurczak". User wyszukuje składniki w spiżarni (baza + produkty sklepowe), a silnik dobiera gramatury pod cel makro slotu.

Każda pozycja może być **stała** („150 g piersi ma zostać 150 g") albo **elastyczna** (solver ją dostraja), z opcjonalnymi limitami `min`/`max`. Wynik jest zwykłym `PosilekWPlanie`, więc wchodzi w plan w miejsce dowolnego posiłku i liczy się do makro dnia oraz do listy zakupów tak samo jak posiłek z bazy przepisów.

Kreator nigdy nie ukrywa nietrafienia w cel: gdy zestawu nie da się dopasować (np. przy zablokowanych 150 g piersi brakuje 20% białka), zwraca to jako ostrzeżenie zamiast po cichu zaakceptować rozjazd.

### Solver gramatur (`lib/engine/solver.ts`)
Ważony najmniejszy kwadrat z ograniczeniami pudełkowymi, rozwiązywany coordinate descentem: minimalizujemy sumę `waga * ((suma - cel)/cel)^2` po kcal i trzech makro, licząc w kółko optymalną ilość jednego składnika przy pozostałych zamrożonych. Problem jest wypukły, więc to zbiega do minimum globalnego. Domyślne wagi: kcal 3, białko 2, tłuszcz 1, węgle 1 — kcal jest tym, o co user pyta wprost, białko bywa najczęściej niedobierane.

Do funkcji celu dochodzi drugi człon: **kara za odejście od typowej porcji** (`porcjaTypowa` składnika, waga `WAGA_TYPOWEJ_PORCJI`). Znormalizowany tak samo jak wagi makro, więc mówi o względnym odchyleniu od porcji, nie o gramach. W kierunkach, gdzie makro realnie zależy od składnika (białko z piersi), dalej wygrywa makro; tam, gdzie funkcja celu jest płaska, wygrywa zdrowy rozsądek. Zamknięta postać kroku coordinate descentu zostaje — człon dokłada się do tej samej paraboli. Pozycja bez `porcjaTypowa` (i pozycja przypięta ręcznie przez usera) ma wagę zero, czyli zachowuje się jak przed zmianą.

Na koniec ilości są zaokrąglane do sensownego kroku (5 g, 1 sztuka), a potem kilka przebiegów „spróbuj o krok w górę/w dół" nadrabia to, co zaokrąglenie zepsuło. Moduł nie ma żadnych zależności — zgodnie z zasadą, że silnik ma dać się przenieść na mobilkę.

To jest też zalążek rozwiązania problemu „plan trafia w kcal, ale rozjeżdża makro" (TODO 7): ten sam solver da się użyć w `planner.ts` do dostrajania proporcji składników przepisu, zamiast skalować cały przepis jednym mnożnikiem.

## Output
- Widok planu na stronie (dzień po dniu, posiłek po posiłku, z kcal/makro).
- Na widoku planu każdy posiłek można przebudować w kreatorze — **bez regenerowania całego tygodnia**. Dlatego lista zakupów jest liczona z gotowego planu (`lib/engine/lista-zakupow.ts`), a nie zbierana po drodze przy jego generowaniu: po podmianie posiłku wystarczy przeliczyć ją od nowa z aktualnych dni. Ten moduł nie dotyka plików z danymi, więc działa też po stronie klienta.
- Przycisk "Pobierz PDF" — generuje PDF z tego samego planu.
- Brak zapisu historii planów na MVP — nowy plan to nowe wypełnienie formularza.

## API
- `POST /api/plan` — generuje plan tygodniowy (zwraca też `celeSlotow`, czyli cel makro per slot, oraz `ostrzezenia[]`). Przyjmuje `charakterPerSlot`, `lubianeSkladniki[]` i `nielubianeSkladniki[]`.
- `POST /api/z-lodowki` — rozpisuje jeden dzień z koszyka składników (zwraca `posilki`, `celeSlotow`, `resztki`, `ostrzezenia`).
- `POST /api/bilans` — bilans mikroskładników dla podanych `dni[]` (każdy to lista składników bazowych) i `plec`. Osobny endpoint, a nie pole w odpowiedzi planu, bo bilans trzeba przeliczyć także po zmianach po stronie klienta: podmianie posiłku w kreatorze albo ręcznej korekcie gramatur.
- `POST /api/z-lodowki/przelicz` — ręczna korekta jednego posiłku: przy zadanym `cel` i `pozycje[]` (z flagą `stala` na tych wpisanych ręcznie) dobiera resztę gramatur. Nie zmienia składu posiłku.
- `GET /api/skladniki?grupowanie=preferencje|lodowka` — pogrupowana lista składników. `preferencje` (domyślne) grupuje wg `grupaPreferencji` na krok „lubię / nie jem tego"; `lodowka` grupuje wg `rolaKulinarna` spłaszczonej do 7 półek spiżarni i dokłada makro, żeby kafelek wpadał do koszyka bez kolejnego zapytania. Trzymane na serwerze, żeby UI nie miał drugiej kopii bazy składników.
- `GET /api/recipes?slot=&charakter=&wyklucz=&nielubiane=` — lista przepisów z makro.
- `GET /api/spizarnia?q=&restrykcje=&limit=&dopuscNieznane=&tylkoBaza=` — wyszukiwarka składników i produktów do kreatora. Trzymana na serwerze, bo `produkty.json` ma ~1 MB i nie ma sensu wysyłać go do przeglądarki.
- `POST /api/posilek/dopasuj` — liczy makro ręcznie złożonego posiłku, a z `dopasuj: true` dobiera gramatury pod `cel`.

## Poza zakresem MVP (do rozważenia później)
- Appka mobilna (Expo) — backend ma być od początku przygotowany żeby to nie wymagało przepisywania.
- Konta użytkowników, zapisywanie historii planów.
- Parsowanie wolnego tekstu restrykcji (NLP) — na start tylko checkboxy.
- Większa, samorosnąca baza przepisów / import z zewnętrznych API przepisów.
- LLM jako pomoc przy tagowaniu/tworzeniu nowych przepisów (offline, nie w runtime).
