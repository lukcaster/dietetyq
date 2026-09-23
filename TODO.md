# TODO — do zrobienia w następnej sesji

## 24. Ulubione rodzaje potraw + wymiana bez limitu — ZROBIONE
Dwa zgłoszenia naraz: budżet trudnych dań ma dotyczyć silnika, ale przy ręcznej wymianie user powinien móc sięgnąć po długie danie; plus nowa kategoria preferencji („co lubisz: naleśniki, jajecznica, jednogarnkowe…").

- Wszystkie 219 dań głównych dostało pole `rodzaj` (14 kategorii), przypisane skryptem z nazw i składów.
- Profil ma `ulubioneRodzaje`, ankieta pyta o nie chipsami, silnik premiuje je w rankingu.
- Wymiana proponuje mieszankę: szybkie / na dłużej / dowolne.

Zmierzone: udział ulubionych rodzajów **27% → 67%** (przy trzech zaznaczonych), przy zachowaniu 9 pozostałych kategorii w planie.

**Ważna obserwacja o rankingu:** `losujNajlepszy` bierze tylko najwyżej ocenionych, więc każda dodatnia premia działa jak filtr — pierwsza wersja dała 86% i monokulturę. Stąd `SZANSA_NA_ULUBIONY = 0.65`. Jeśli kiedyś dojdzie kolejna premia, ten sam problem wróci.

Co dalej:
- **`rodzaj` trzeba uzupełniać ręcznie** przy nowych przepisach — skrypt tagujący był jednorazowy i nie jest w repo.
- **Podział na rodzaje jest miejscami arbitralny**: „Pasta jajeczna" jest w `jajka`, choć je się ją na kanapce; hummus wylądował w `przekaski`.
- **Nie da się zmienić ulubionych bez wypełniania ankiety od nowa** — to ten sam brak edycji profilu, co w punkcie 20.
- Sprawdzarka bazy nie weryfikuje, czy każdy przepis ma `rodzaj`.

## 23. Trzy zgłoszenia: jajecznica, za dużo gotowania, brak przepisu na ciasto — ZROBIONE

**1. „Nigdy nie trafiłem jajecznicy".** To była matematyka, nie błąd: 76 przepisów na śniadanie znaczy ~9% szans na konkretne danie w tygodniu. Doszły trzy klasyki (ze szczypiorkiem na maśle, z pomidorami, z kiełbasą). Teraz 7 z 79 śniadań to jajecznica, czyli **~48% szans na tydzień**. Dalej nie ma gwarancji — to jest wbudowane w wielkość bazy.

**2. Za dużo skomplikowanych przepisów.** Wprowadzony budżet trudnych dań na plan (1/2/3 dla 1/3/7 dni) z rozkładaniem na weekend po dacie startu. Mechanika w SPEC.

**3. Przepis na pizzę i pierogi nie mówił, jak zrobić ciasto.** Prawdziwy bug: instrukcje komponentów były czytane tylko do makro. Naprawione, patrz SPEC („Półprodukty w planie").

Co dalej:
- **Klasyki toną w dużej bazie.** Przy 229 przepisach każdy pojedynczy jest rzadki. Docelowym rozwiązaniem nie jest dokładanie kolejnych wariantów, tylko mechanizm „ulubione" — user oznacza dania, które mają wypadać częściej.
- **Rozkładanie na weekend liczy dni, nie sloty.** Jeden weekendowy dzień potrafi wziąć dwa trudne dania, więc przy budżecie 3 i dwóch dniach weekendu jedno i tak trafia w tydzień.
- **Budżet nie zna godzin.** Nie odróżnia „30+ minut" od „dwie godziny duszenia" — bigos i kotlet z piekarnika są traktowane tak samo.
- **Tryb „z lodówki" nie zna budżetu** (i tak jest zawieszony).

## 22. Polska klasyka w bazie — ZROBIONE
Baza miała sporą dziurę: **zero zup** poza kremami, brak klusek, gołąbków, bigosu, fasolki, twarożku i sałatki jarzynowej. Doszło 16 przepisów i 4 składniki (`kielbasa`, `smietana-18`, `groszek-konserwowy`, `grzyby-suszone`).

Zupy: rosół z makaronem, pomidorowa z ryżem, ogórkowa, krupnik, barszcz czerwony. Drugie dania: gołąbki, bigos, fasolka po bretońsku, leczo z kurczakiem, placki ziemniaczane, kopytka, leniwe, makaron z twarogiem. Na kolację: twarożek ze szczypiorkiem, pasta jajeczna, sałatka jarzynowa.

Uwagi:
- **Żurku nie ma**, bo wymaga zakwasu — nie ma go w bazie i trudno go sensownie policzyć.
- **Zupy są rozpisane na 4-6 porcji**, więc silnik skaluje je w dół do jednej. To ten sam problem, co w punkcie o dużych daniach: sensowniej byłoby powiedzieć „ugotuj garnek, jedz przez trzy dni".
- Bigos i fasolka to dania tłuste (28-31 g tłuszczu na porcję) — przy niskim celu kalorycznym wyjdą z nich małe porcje.
- Przy 226 przepisach **pojedyncze danie pojawia się w planie rzadko** (zmierzone: 1-2 nowe pozycje na 35 posiłków tygodnia). To normalne przy tej wielkości bazy, ale znaczy też, że dokładanie kolejnych przepisów ma coraz mniejszy wpływ na to, co user realnie widzi.

## 21. Wolny silnik i modal, który wyglądał na zepsuty — NAPRAWIONE
Zgłoszenie: „klikam wymień i modal otwiera się dopiero jak dam zrezygnuj z planu". To nie był błąd renderowania — modal czekał na odpowiedź serwera. Zmierzone w dev: **pierwsze wywołanie 13,7 s** (kompilacja trasy), kolejne 2,4-3,6 s.

Dwie przyczyny i dwie naprawy:
1. **Brak informacji zwrotnej.** Modal otwiera się teraz natychmiast, ze spinnerem, a propozycje dolatują do niego później.
2. **Silnik czytał pliki z dysku przy każdym wywołaniu.** `getRecipes`/`getIngredients` parsowały JSON-y za każdym razem, a `getIngredientById` robił `find` po 218 pozycjach — przy jednej wymianie to setki odczytów. Kuratorowane pliki są teraz trzymane w pamięci **na produkcji** (w dev dalej czytane z dysku, żeby ręczna edycja JSON-a działała od razu) plus mapa id → składnik.

Zmierzone po zmianie na buildzie produkcyjnym: wymiana posiłku **15-100 ms**, plan na 7 dni **83 ms**.

Do zapamiętania: **w dev pierwsze wywołanie trasy API zawsze będzie wolne** (Turbopack kompiluje ją na żądanie) — to nie jest błąd aplikacji.

## 20. Przebudowa na aplikację z profilem — ZROBIONE, co dalej
Apka przestała być sześciokrokowym kreatorem. Jest profil (ankieta raz), menu, plan na 1/3/7 dni, widok „co jeść teraz" z odhaczaniem, lista zakupów do odhaczania i wymiana posiłku z trzema propozycjami. Architektura w SPEC („Architektura aplikacji").

Co dalej:
- **Dane żyją tylko w przeglądarce.** Warstwa `lib/magazyn.ts` jest wydzielona pod przyszły zapis serwerowy (kod dostępu + baza), ale dopóki go nie ma, plan ginie przy czyszczeniu danych strony i nie przechodzi na telefon.
- **Kreator własnego posiłku (`KreatorPosilku.tsx`) wypadł z UI.** Kod jest, wejścia nie ma — wcześniej siedział pod „Zbuduj sam" przy posiłku.
- **Tryb „z lodówki" zawieszony** na prośbę usera: kod i API zostają, ale nie ma do niego wejścia.
- **Edycja profilu jest tylko do odczytu** — da się obejrzeć ustawienia i wyczyścić wszystko, ale nie zmienić pojedynczego pola bez wypełniania ankiety od nowa.
- **Waga nie zmienia kalorii, gdy user wpisał je wprost.** Przeliczanie działa tylko w trybie „policz za mnie". Do przemyślenia, czy przy spadku wagi nie proponować korekty także tym, którzy podali kcal ręcznie.
- **Postęp jest przypisany do pozycji w planie (`dzien:indeks`)**, więc po wymianie posiłku odhaczenia się nie przesuwają — ale gdyby kiedyś dochodziło usuwanie dni, trzeba to przemyśleć.
- Nie ma cofania całego planu ani historii poprzednich planów.

## 19. Styl gotowania i sprzęt w kuchni — ZROBIONE, co dalej
Pomysł usera: zamiast tylko „lubię / nie lubię składników" dać też kategorie w rodzaju „lubię piec", „chcę jak najszybciej", „nie mam piekarnika / airfryera / blendera". Mechanika w SPEC („Styl gotowania i sprzęt").

Rozbite na dwie różne rzeczy: styl gotowania działa **miękko** (premia w rankingu), brak sprzętu **twardo** (filtr). Pole `sprzet[]` wyznaczone automatycznie z treści instrukcji.

Co dalej:
- **Tagowanie sprzętu jest zgadywane ze słów kluczowych**, nie wpisane ręcznie. Wyłapałem dwa fałszywe trafienia („pieczywo", „podpiecz na patelni"), ale przy 201 przepisach mogło zostać więcej. Przy dopisywaniu nowych przepisów trzeba pamiętać, żeby `sprzet` uzupełnić ręcznie — skrypt tagujący był jednorazowy i nie jest w repo.
- **Tryb „z lodówki" nie zna sprzętu ani stylu** — tam UI o to nie pyta, a przepisy dobiera osobna ścieżka.
- **Nie ma kategorii „meal prep"** (gotuję raz na kilka dni), o której user wspominał jako możliwej. Wymagałaby premiowania przepisów na 2+ porcje i pokazywania, co odgrzać następnego dnia.
- Airfryer nie jest osobnym sprzętem, bo w bazie zawsze jest alternatywą dla piekarnika. Gdyby doszły przepisy wyłącznie na airfryer, trzeba będzie go rozdzielić.
- `czasPrzygotowania` dla 143 przepisów z importu PDF było **szacowane po liczbie kroków**, więc premia za czas opiera się częściowo na zgadywanych danych.

## 18. Ciasto pierogowe z większą ilością białka — ZROBIONE
Zgłoszenie wyszło z nieporozumienia („nie dam dzieciom odżywki białkowej w cieście na pierogi") — ciasto pierogowe **nigdy nie miało odżywki**, jest z mąki i jajka. Odżywka siedzi w `fit-pampuchy-pieczone`, `nalesniki-proteinowe-dzem`, `ciasto-proteinowe-kasza-manna-borowki` i trzech pozycjach z importu. Sam pomysł „więcej białka bez proszku" był jednak dobry.

Doszły dwa komponenty i jeden składnik (`mleko-w-proszku`, odtłuszczone):
- **`ciasto-pierogowe-twarogowe`** (mąka pełnoziarnista 250 g + twaróg chudy 200 g + jajko): **79 g białka na 500 g ciasta** zamiast 46 g, przy praktycznie tych samych kaloriach. Na nie przestawione zostały wszystkie trzy `pierogi-fit-*` — porcja zyskuje ~8 g białka kosztem 7 kcal.
- **`ciasto-pierogowe-z-mlekiem-w-proszku`** (mąka 280 g + 40 g mleka w proszku + jajko + woda): 57,6 g białka, ale zachowuje się przy wałkowaniu dokładnie jak zwykłe ciasto — wariant dla kogoś, kto nie chce zmieniać techniki.

Co dalej:
- **Ciasto twarogowe nie było testowane w kuchni**, tylko policzone. Jest bardziej miękkie i wymaga podsypywania mąką — jeśli w praktyce okaże się zbyt delikatne przy gotowaniu, trzeba będzie zejść z twarogu do ~150 g.
- Stare `ciasto-pierogowe-pelnoziarniste` zostaje w bazie, ale **nie jest już przez nic używane**.
- Warto tą samą drogą pójść przy pampuchach i naleśnikach proteinowych, żeby odżywka nie była jedynym sposobem na białko w cieście.

## 17. Import przepisów z planów PDF — ZROBIONE, co dalej
Z 7 PDF-ów (plany dietetyczne kupione przez usera) wyciągnięte zostały przepisy: `pdftotext -layout` + parser kolumn, ręczne mapowanie nazw składników, własne instrukcje. Baza urosła z **56 do 199 przepisów** i z 134 do **217 składników**. Zasady importu w SPEC („Skąd biorą się przepisy w bazie").

Liczby z przebiegu: 175 nagłówków w PDF-ach → 167 sparsowanych → 150 po mapowaniu składników → **143 w bazie** (7 odpadło na kontroli makro, 17 wcześniej na markowych półproduktach typu „Pinsa" czy granola konkretnej firmy).

Co dalej:
- **83 nowe składniki nie mają `mikroNa100g`** i wypadają z bilansu mikroskładników (sprawdzarka to zgłasza). Mapowania USDA są już dopisane w `scripts/import-mikro.mjs`, więc wystarczy puścić `npm run import-mikro --zapisz` z darmowym kluczem USDA.
- **Makro nowych składników jest z tabel, nie z etykiet.** Zwłaszcza pozycje przetworzone (hummus, sos barbecue, pieczywo chrupkie) potrafią się różnić między producentami.
- **Przekąski typu „jabłko + orzechy" pokrywają się w 70-75%** (sprawdzarka je pokazuje). To świadome: różnią się rodzajem orzechów. Gdyby przeszkadzały, najprościej zwinąć je do jednego przepisu z grupą wyboru.
- **Siódmy PDF (dieta hiszpańska) ma inny układ i nie został zaimportowany** — parser nie znalazł w nim ani jednego nagłówka posiłku.
- Część przepisów jest na 1 porcję ~800 kcal (plany były liczone na 2900 kcal dziennie). Silnik i tak je przeskalowuje, ale przy niskim celu kalorycznym wychodzą z tego małe porcje.

## 16. Domykanie białka zwykłym jedzeniem — ZROBIONE, co dalej
Zgłoszenie i zarazem **zasada produktowa**: „nie chcę, żeby to było »jedz białko, syp odżywkę, bo nie będziesz fit«. W tej apce chodzi o to, żeby zdrowiej jeść, a nie trzymać makro jak strongwoman". Zamiast tego: jak w jakimś dniu brakuje białka, niech silnik dorzuci plaster szynki do śniadania albo trochę więcej mięsa do obiadu.

Zrobione (mechanika w SPEC, sekcja „Domykanie dnia"):
- `lib/engine/domykanie.ts` — po złożeniu dnia, gdy brakuje >15 g białka, silnik dokłada do posiłków zwykłe jedzenie (szynka, ser, jajko, twaróg, skyr, serek wiejski, +50 g piersi do obiadu z kurczakiem). Maks. 3 dosypki dziennie, sufit +5% kcal, losowanie zamiast „zawsze najbardziej białkowa opcja".
- **Odżywki białkowe wypadły z automatu** — gotowiec sięgnie po whey tylko wtedy, gdy user sam ją zaznaczy jako lubianą. W przepisach zostają (fit pampuchy, naleśniki proteinowe to świadome przepisy z bazy).
- Ton UI na widoku planu: „to są widełki, nie normy do wyrobienia".

Zmierzone: dni z 93-120 g białka wychodzą po domknięciu na 100-160 g przy celu 165.

Co dalej:
- **Przy braku zapasu kalorii dzień zostaje nisko** (widziany przypadek: 100 g przy celu 165, bo kcal już były wyczerpane). Sensowniejsze niż dokładanie byłoby wtedy **zamienienie** czegoś — np. jogurt naturalny zamiast słodkiego — ale to wymaga mechanizmu podmiany składnika, nie dokładania.
- **Lista kandydatów jest ręczna i mięsno-nabiałowa.** Dla kogoś bez laktozy zostaje głównie szynka i jajko. Warto dorzucić strączki, rybę i coś roślinnego (tofu, hummus).
- **Dosypka nie trafia do instrukcji przygotowania** — „jajko na twardo" pojawia się jako dopisek, ale przepis o nim nie wie.
- Nie ma domykania w trybie „z lodówki" — tam dokładanie musiałoby pytać, czy user w ogóle to ma.

## 15. Powtarzalny plan tygodniowy + „gotowce" — ZROBIONE, co dalej
Zgłoszenie: „plan na tydzień, a codziennie mam te same przepisy". Zmierzone: przy **wybranym charakterze posiłku** pula potrafi zejść do jednego przepisu (wytrawne drugie śniadanie = 1 przepis w bazie) i user dostaje go 7 razy. Bez charakteru było 7/7 unikalnych już wcześniej — więc winny był filtr, nie losowanie.

Trzy zmiany (mechanika w SPEC):
1. **Krok 2 to teraz jedna liczba 3-5** zamiast multi-select slotów i charakteru per slot. Układ dnia jest sztywny. `charakterPerSlot` zostało w API, ale UI go nie wysyła.
2. **Powtórki liczone w skali tygodnia i wszystkich slotów**, nie per slot.
3. **Gotowce** (`lib/engine/gotowce.ts`) — lekkie posiłki składane z szablonów i składników bazowych, bez przepisu. Doszły flagi `wymagaGotowania` / `tylkoNaZimno` / `naZimno`, instrukcje dla wszystkich 10 szablonów (przydają się też w trybie z lodówki, gdzie szablony były bez opisu) i rozdzielenie ról `makaron` / `straczne` od `kasza-ryz`.

Zmierzone po zmianie: 7/7 unikalnych w każdym slocie, kcal dnia w granicach 2% od celu.

Co dalej boli:
- ~~**Białko dalej skacze**~~ — częściowo załatwione domykaniem dnia, patrz punkt 16.
- **Przy podwójnej restrykcji (bez laktozy i glutenu) drugie śniadanie schodzi do 3/7 unikalnych.** Szablony się kończą i zaczynają wracać z podobnym składem.
- **`SZANSA_NA_GOTOWIEC` jest wpisana z głowy** (0,6 / 0,5 / 0,25 / 0,2 / 0) — nikt tego nie kalibrował, a to steruje charakterem całego planu. Naturalne rozwinięcie: pytanie w formularzu „ile chcesz gotować".
- **Gotowiec nie ma czasu przygotowania ani charakteru** (słodkie/wytrawne), więc nie da się go filtrować tak jak przepisu.
- **Lista zakupów przy gotowcach robi się długa i drobna** — 15 g sezamu, 20 g keczupu. Do rozważenia zaokrąglanie do opakowań.

## 1. ~~Przyciski na ostatnim widoku poza scrollowanym kontenerem~~ ✅ zrobione (naprawione drugi raz — pierwsza próba nie działała)
Pasek `.przyciski-nawigacji` miał `position: fixed` już wcześniej, ale **to nie działało na długich widokach** i dlatego problem wracał.

Przyczyna: `.panel` miał `backdrop-filter: blur(18px)`, a `backdrop-filter` (tak samo jak `filter` i `transform`) robi z elementu **blok zawierający dla potomków `position: fixed`**. Pasek jest w środku panelu, więc „przyklejał się" do dołu panelu zamiast do dołu okna. Na krótkich krokach panel ma mniej więcej wysokość ekranu i wyglądało to poprawnie — na kroku z przepisami i w kreatorze panel ma kilka ekranów, więc przyciski uciekały na sam dół scrolla.

Naprawa: blur przeniesiony na `.panel::before` (ten sam wygląd, panel przestaje łapać `fixed`). Dolny padding `.wrapper` podniesiony do 150px, bo na wąskim ekranie pasek łamie się na dwa rzędy. **Pamiętać przy stylowaniu:** żadnego `filter`/`backdrop-filter`/`transform` na kontenerze, w którym siedzi coś `fixed`.

## 2. ~~Przepisy nie pokrywają pełnowartościowego obiadu~~ ✅ zrobione
Dodano mechanizm `kategoriaDania` + `wymaganeDodatki` (patrz SPEC.md). Kotlety i nuggetsy mają teraz `["dodatek-skrobiowy", "surowka"]` — silnik automatycznie dobiera ryż/ziemniaki/kaszę/frytki + mizerię/surówkę z kapusty/sałatkę pomidorowo-ogórkową, dzieląc kcal/makro posiłku (główne ~65%, skrobiowy ~22%, surówka ~13%). Pierogi i tortilla pizza zostały bez dodatków (już kompletne). Pamiętać o tej zasadzie przy kolejnych daniach głównych.

## 3. ~~Plan wydaje się powtarzalny~~ ✅ zrobione
`wybierzKandydata` nie bierze już „pierwszego nieużytego z tablicy" — zawęża pulę tak jak wcześniej (nieużyte w tygodniu → nieużyte dzisiaj → wszystko), ocenia ją liczbą lubianych składników i **losuje spośród najlepiej ocenionych** (`losujNajlepszy` w `planner.ts`).

Zmierzone na 2200 kcal, sloty śniadanie/obiad/kolacja: przed zmianą 7 unikalnych dań na tydzień (zawsze te same, w tej samej kolejności), po zmianie **16–19 unikalnych dań** i dwa kolejne przebiegi dają różne plany. Przycisk „Inny wariant" wreszcie robi to, co obiecuje.

## 4. Możliwość wymiany przepisu przez użytkownika (krok 4 — akceptacja planu) — CZĘŚCIOWO ZROBIONE
Infrastruktura jest gotowa: na kroku 4 każdy posiłek ma przycisk "Zbuduj sam", podmiana nie regeneruje planu, a makro dnia i lista zakupów przeliczają się na miejscu (`zbudujListeZakupow` liczy z gotowych dni, patrz SPEC).

Czego brakuje: **wymiany na inny przepis z bazy** — user może dziś przebudować posiłek ze składników, ale nie może powiedzieć "daj mi tu inne danie z bazy, ten sam slot/charakter/restrykcje". Wymaga listy kandydatów z `/api/recipes` przefiltrowanej po slocie i wykonalności + przeskalowania wybranego przepisu do celu slotu (to samo co robi `przygotujPozycje`, tylko wywołane punktowo).

## 5. Przycisk "Zakończ" na ostatnim widoku
Zamiast/obok "Wstecz" na widoku 5 — przycisk kończący sesję i wracający do kroku 1 z wyczyszczonymi danymi. Do przemyślenia, czy to dobry UX (użytkownik mówił, że niepewny czy to dobry pomysł) — możliwe że lepiej zostać na widoku z planem i dać "Zacznij nowy plan" jako jaśniejszą nazwę.

## 6. ~~Potrzeba więcej przepisów~~ ✅ baza rozbudowana (35 przepisów)
Dodano: placuszki jogurtowe, fit pampuchy pieczone (z odżywką białkową w cieście), 4 warianty tortilli (szynka/ser/warzywa grillowana, z jajkiem na patelni, z kurczakiem i rukolą, w stylu mcwrapa z mięsem mielonym), szakszuka na chorizo, jajecznica na boczku, grzanki z mozzarellą, mini pizza i buleczki z serka wiejskiego, kotlet drobiowy w panierce owsianej (piekarnik/airfryer), pulpeciki w sosie pomidorowym, 3 naleśniki z różnym nadzieniem (czekoladowo-daktylowe, twaróg+skyr, proteinowe z dżemem) + nowy dodatek "Pieczywo" (kategoria `dodatek-skrobiowy`, podłączony do szakszuki/jajecznicy). Nowa kategoria zamienników `maka` (pszenna/owsiana/ryżowa) — używana tylko w cienkich ciastach (naleśniki), nie w pieczonych ciastach/pierogach, gdzie struktura glutenu ma znaczenie. Dalej można rozbudowywać — pamiętać o zasadzie z pkt 2 (`wymaganeDodatki`) i o zamiennikach (`kategoria`) przy każdym nowym alergennym składniku.

## 7. Silnik liczy tylko kcal, nie pilnuje proporcji makro — ZMIERZONE, jest gorzej niż się wydawało
Rozkład makro da się już ustawić w kroku 1 (domyślnie 30/35/35) i trafia do targetu oraz do kreatora — ale **plan go nie realizuje**. Pomiar na 2200 kcal, 30/35/35, sloty śniadanie/obiad/kolacja:

| dzień | kcal | udział kcal B/T/W |
|-------|------|-------------------|
| 1 | 2200 | **18** / 30 / 51 % |
| 3 | 2200 | 31 / 23 / 48 % |
| 7 | 2200 | 33 / 33 / 32 % |

Średnio w tygodniu: białko 147 g przy celu 165 g (**-11%**), węgle 244 g przy celu 192 g (**+27%**). Kcal trafione co do jednej, makro potrafi się rozjechać dwukrotnie między dniami — dzień 1 daje 18% kalorii z białka przy celu 30%.

Obecnie `generujPlan` skaluje każdy przepis tak, żeby trafić w target kcal danego slotu/posiłku, ale **nie wybiera ani nie dostraja przepisów pod kątem proporcji białko/tłuszcz/węgle**. Czyli user może mieć dobrze trafiony kcal, ale rozjeżdżające się makro (np. zbyt mało białka), bo silnik nie sprawdza tego przy doborze kandydata. User przygotuje dokładne normy/wytyczne do tego później — na razie zanotować, że to wymaga zmiany w `planner.ts` (np. wybór kandydata najbliższego docelowemu rozkładowi % makro, nie tylko najbliższego kcal, plus być może drobne dostrajanie proporcji składników a nie tylko jednolite skalowanie całego przepisu).

**Połowa narzędzia już jest:** `lib/engine/solver.ts` dobiera gramatury pod pełne makro (kcal + B/T/W) z ograniczeniami na składnik i działa w kreatorze. Do wpięcia w planner brakuje dwóch rzeczy: (a) doboru kandydata po odległości od docelowego rozkładu makro, nie po samym kcal, (b) decyzji, **które składniki przepisu wolno ruszać** — skalowanie ryżu czy oliwy jest bezpieczne, ale dosypanie mąki w cieście na pierogi rozwali przepis. Prawdopodobnie potrzebna flaga typu `elastyczny: true` na pozycji składnika w `recipes.json`.

## 8. Kreator własnego posiłku — ZROBIONE, co dalej
User może zbudować posiłek ze składników zamiast brać przepis: wyszukiwarka (kuratorowana baza + ~4800 produktów sklepowych z Open Food Facts), blokowanie gramatur ("150 g piersi zostaje"), solver dobierający resztę pod cel makro slotu, ostrzeżenia gdy celu nie da się trafić. Szczegóły w SPEC (sekcje "produkty sklepowe", "Kreator własnego posiłku", "API").

Pomysły na dalej:
- **Zapis własnego posiłku jako przepisu** — jeśli user złoży coś dobrego, powinno dać się to wrzucić do `recipes.json` (choćby przez wyeksportowanie JSON-a do ręcznego wklejenia, żeby utrzymać zasadę kuratorowanej bazy).
- **Skanowanie kodu kreskowego** — produkty mają `kod`, więc wyszukiwanie po kodzie to jedna linijka w spiżarni; front wymagałby dostępu do kamery.
- **Odświeżanie produktów z OFF** — dziś to jednorazowy snapshot. Warto raz na jakiś czas puścić import ponownie i zobaczyć, czy makro się nie zmieniło.
- **Tryb w pełni ręcznego planu** — dziś kreator wchodzi tylko jako podmiana posiłku w wygenerowanym planie; osobną ścieżką byłoby budowanie całego tygodnia od zera.
- Rozważyć podniesienie progu jakości importu: 41% produktów ma nieuzupełnione alergeny (przy aktywnych restrykcjach są domyślnie ukrywane, ale to i tak spora dziura w bazie).

## 9. Preferencje smakowe — ZROBIONE, co dalej
Formularz ma teraz 4 kroki: kcal/makro → posiłki + charakter (słodkie/wytrawne/bez znaczenia per slot) → alergeny → lubiane i nielubiane składniki. Szczegóły mechaniki w SPEC ("Krok 4: lubiane i nielubiane składniki").

Pomysły na dalej:
- **Nielubiane wycinają za dużo przy małej bazie.** Odznaczenie jajka + nabiału + płatków potrafi zabić całą pulę śniadań (silnik pokazuje wtedy ostrzeżenie, ale to plaster, nie rozwiązanie). Docelowo: albo więcej przepisów, albo traktowanie części nielubianych miękko — „unikaj, ale jak nie ma nic innego, to dawaj" jako trzeci stan chipsa.
- **Lubiane nie wpływają na dodatki tak, jak powinny.** Ocena liczy lubiane składniki w daniu głównym i w dodatku osobno; kto zaznaczy „ryż", dostanie ryż tylko wtedy, gdy akurat wylosuje się danie z `wymaganeDodatki`. Warto oceniać posiłek jako całość (danie + dodatki).
- **Preferencje nie przechodzą do kreatora.** Wyszukiwarka spiżarni dalej pokazuje nielubiane składniki — świadomie, bo w kreatorze user buduje ręcznie i wie, co robi. Do przemyślenia, czy nie powinny lecieć chociaż na koniec listy wyników.
- **Zapamiętywanie preferencji** — dziś każde wejście na stronę to klikanie od zera. Bez kont wystarczyłby `localStorage`.

## 11. Bilans mikroskładników — ZROBIONE, co dalej
Osiem pozycji (błonnik, żelazo, wapń, magnez, potas, cynk, wit. C, sód) liczonych dla obu ścieżek. Mechanika i zasady w SPEC („Bilans mikroskładników").

Zmierzone na planie tygodniowym 2200 kcal: żelazo 169% i cynk 166% normy, ale **błonnik źle w 4 z 7 dni**, wapń w 3, sód przekroczony w 3. Czyli funkcja od razu pokazała realne dziury w tym, co silnik generuje.

Co jest słabe i warto poprawić:
- **Dane są wpisane z tabel, nie zmierzone.** 65 składników × 8 wartości kuratorowanych ręcznie — pierwsze przybliżenie. **Najpilniejsze: puścić `scripts/import-mikro.mjs` z darmowym kluczem USDA** i przejrzeć raport różnic. Skrypt jest gotowy i sam nic nie nadpisuje bez `--zapisz`.
- **Mapowanie na USDA pokrywa 55 z 65 składników.** Bez odpowiednika zostają m.in. mleko A2, odżywki białkowe, skyr smakowy, jogurt sojowy smakowy — dla nich wartości z repo zostaną na zawsze przybliżone, chyba że ktoś przepisze je z etykiet.
- **Produkty z Open Food Facts nie mają mikro w ogóle.** Import z OFF ciąga tylko 4 pola makro (`import-off.mjs:136`), a `nutriments` ma już w odpowiedzi m.in. `fiber_100g`, `iron_100g`, `sodium_100g`. Dodanie ich to zmiana w mapowaniu + ponowny import — pokrycie będzie dziurawe, ale lepsze niż zero. Dziś każdy produkt sklepowy w koszyku obniża `pokrycieMasy`.
- **Normy nie zależą od wieku ani stanu fizjologicznego.** Jedna tabela na płeć; ciąża, karmienie i wiek 50+ realnie zmieniają zapotrzebowanie (zwłaszcza żelazo i wapń). Płci nie znamy nawet zawsze — w ścieżce „wpiszę kcal sam" domyślamy się męskiej i tylko o tym piszemy.
- **Brak podpowiedzi, czym niedobór uzupełnić.** Wiemy, że brakuje 40% błonnika i że kasza gryczana ma go 10 g/100 g — połączenie tych dwóch rzeczy w „dorzuć do koszyka kaszę" to naturalny następny krok i pasowałoby do trybu „z lodówki".
- **Mikro nie wpływa i nie ma wpływać na dobór posiłków** — to świadoma decyzja (patrz SPEC). Gdyby kiedyś miało, to nie przez solver, tylko przez ranking kandydatów, i z bardzo małą wagą.

## 10. Tryb „z lodówki" — ZROBIONE, co dalej
Druga ścieżka obok przepisów: user podaje kcal/makro, sloty i koszyk tego, co ma, a silnik rozpisuje **jeden dzień** — co i ile zjeść w każdym slocie, bez przepisów. Mechanika w SPEC (sekcja „Tryb z lodówki").

Zmierzone na 2200 kcal, 3 sloty, koszyk 9 składników: wszystkie sloty w granicach 1-3% od celu, dzień 2217/2200 kcal, B 165/165. Przy koszyku „kurczak + ryż" silnik trafia kcal i białko, ale zgłasza 88% rozjazdu na tłuszczu i mówi o tym wprost, zamiast udawać.

**Tryb używa teraz przepisów z bazy**, a szablony zostały fallbackiem. Silnik szuka przepisów wykonalnych z koszyka, skaluje je w całości jednym mnożnikiem i pokazuje ich instrukcje. Szczegóły w SPEC.

Przy okazji poluzowany został nacisk na makro (`WAGA_ROZJAZDU = 1/6` + losowanie w promieniu 10 pkt): wcześniej wygrywały zawsze te 2-3 zestawy, które idealnie trafiały w cel, a reszta bazy nie wypadała nigdy. Zasada: lepiej zjeść z apetytem sensowne danie i mieć dzień z białkiem na 85% normy, niż dostać w kółko to samo.

Baza urosła o 6 przepisów (naleśniki wysokobiałkowe, grillowany kurczak z warzywami i skrobią, omlet na słodko, omlet na słono, udon z wieprzowiną gochujang, sałatka big-mac) i 14 składników. Doszły dwie kategorie zamienników: `skrobia-obiadowa` (ryż/ziemniaki/kasza) i `warzywo-cieple` — dzięki nim jeden przepis na kurczaka łapie się o dowolną skrobię i dowolne warzywo z lodówki.

Co dalej w tym obszarze:
- **Przepisy na 2+ porcje są skalowane w dół do jednej.** Udon (2 porcje) przy celu ~800 kcal zostanie przeskalowany, zamiast zaproponować „ugotuj całość, drugą porcję zjesz jutro". Marnuje to sens dużych dań i nie korzysta z `resztki[]`.
- **Nie ma soli ani przypraw w bazie**, a instrukcje mówią „dopraw solą i pieprzem". Do bilansu sodu to realna dziura (patrz pkt 11).
- **Brak podmiany dania.** Losowanie daje różnorodność między przebiegami, ale user nie może powiedzieć „nie chcę dziś omletu, daj coś innego" bez przeliczania całego dnia.

**Wcześniej przebudowane na szablony dań** po zgłoszeniu „nikt nie zje szynki z ryżem, mlekiem i pomidorem". Diagnoza: poprzednie podejście (rola z makro + powinowactwo do slotu + słodkie/wytrawne per slot) opisywało **pojedyncze składniki**, a problem jest **parami** — szynka i ryż z osobna są wytrawne i obiadowe, dopiero razem są nonsensem. Trzy heurystyki wyrzucone, zastąpione jednym mechanizmem: `data/szablony.json` + pole `rolaKulinarna` w `ingredients.json`. Szczegóły w SPEC.

Co jest słabe i warto poprawić:
- **Wagi wyboru szablonu są dostrojone „na oko".** Rozjazd/2, świeżość ×3, powtórka −10 (`WAGA_SWIEZOSCI`, `KARA_ZA_POWTORKE` w `z-lodowki.ts`) — dobrane tak, żeby zniknęła jajecznica na śniadanie *i* na kolację przy nietkniętych płatkach. Przy 5 slotach niewykorzystane zostają zwykle 2-3 składniki. Docelowo waga świeżości powinna rosnąć wraz z tym, ile koszyka jeszcze nie weszło, zamiast być stałą.
- **Ręczna korekta jest tylko na gramaturach.** Da się już wpisać własną ilość i przypiąć ją (🔒), a solver przelicza resztę posiłku. Dalej nie da się powiedzieć „ten twaróg ma iść na kolację, nie na śniadanie" ani „daj mi tu inne danie" — przenoszenie składników między posiłkami i podmiana szablonu to następne w kolejce.
- **Korekta nie pilnuje zapasu.** `przeliczPosilek` nie wie o `dostepneIlosc` ani o tym, ile tego składnika poszło do innych posiłków — user może ręcznie wpisać 300 g piersi w dwóch posiłkach, mając 400 g. Do domknięcia razem z przenoszeniem składników między slotami.
- **Wybór szablonu jest zachłanny, slot po slocie.** Optymalnie należałoby wybierać zestaw dań na cały dzień naraz (wybór na śniadanie zabiera składniki obiadowi). Da się skonstruować koszyk, gdzie ręczna zamiana dwóch dań da lepszy wynik.
- **Podstawowych zapasów są tylko dwa** (olej, oliwa — flaga `zawszeWDomu`). Naturalni kandydaci, których w bazie w ogóle nie ma: sól, pieprz, przyprawy. Sól ma znaczenie dla bilansu sodu, więc jej dodanie realnie zmieni liczby — dziś sód liczymy tylko z produktów, bez dosalania.
- **Sufit sztuk potrafi dać absurd przy jednym slocie.** Przy „cały dzień = jeden posiłek 2000 kcal" mnożnik sufitu (×2) daje 12 jajek. Formalnie zgodne z regułą, kulinarnie nie. Warto dołożyć twardy sufit absolutny niezależny od mnożnika.
- **10 szablonów to mało.** Brakuje m.in. zup, makaronów, naleśników, dań jednogarnkowych. Dodanie szablonu to kilka linii JSON-a — to najtańsza droga do lepszych wyników.
- **Produkty z OFF nie mają roli kulinarnej**, więc nie wypełniają gniazd i lądują jako „uzupełnienie w ciemno". Da się to podeprzeć kategoriami OFF (`en:breakfast-cereals` itd.) przy imporcie.
- **Sufity per rola i progi są zgadywane.** 150 g pieczywa / 100 g wędliny / 60 g sera / 15 g minimalnej porcji to wartości z sufitu, nie z normy. Podobnie mnożnik sufitu wzgl. celu slotu (`kcal/600`, przycięty do [0,6; 2,0]). Do skalibrowania na realnych porcjach.
- **Jeden dzień to jeden dzień.** Naturalne rozwinięcie: „zaplanuj kolejny dzień z tego, co zostało" — `resztki[]` już są policzone, więc to głównie kwestia UI.
- **Brak PDF-a i listy zakupów** — w tym trybie lista zakupów nie ma sensu (masz to w domu), ale „czego ci brakuje, żeby trafić w cel" już tak.

## 12. Tryb „z lodówki" — porcje i zapas (naprawione)
Zgłoszenie: „te rzeczy, które wypluwa ten algorytm, to straszna lipa". Odtworzone na trzech realnych koszykach i na 150 losowych dniach — wyszły trzy osobne rzeczy.

**a) Solver nie miał pojęcia o wielkości porcji.** Składnik, który prawie nie rusza makro (ogórek: 12 kcal/100 g, zero białka), daje płaską funkcję celu, więc coordinate descent lądował na losowym krańcu przedziału: 200 g ogórka w kanapce, 135 g cebuli w daniu, 4 jajka na kanapce, a obok 15 g borówek przy 250 g w koszyku. Doszły dwa pola w `ingredients.json` (`porcjaTypowa`, `maksPorcja` — opis w SPEC) i drugi człon w funkcji celu solvera. Uzupełnione dla 77 z 84 składników; bez porcji zostały mąki, drożdże i woda, bo to półprodukty żyjące tylko wewnątrz przepisu.

Waga członu (`WAGA_TYPOWEJ_PORCJI`) dobrana pomiarem, nie na oko — 150 losowych dni, odsetek porcji przekraczających dwukrotność typowej kontra średni rozjazd od celu:

| waga | absurdalne porcje | rozjazd kcal | rozjazd białka |
|------|-------------------|--------------|----------------|
| 0    | 13,4 %            | 27,0 %       | 43,8 %         |
| 0,08 | 10,3 %            | 29,4 %       | 47,8 %         |
| **0,2** | **7,2 %**      | **30,4 %**   | **48,5 %**     |
| 0,4  | 5,8 %             | 32,6 %       | 51,8 %         |

Stoi na 0,2 — połowa absurdalnych porcji mniej niż przy zerze, kosztem ~3 pkt proc. rozjazdu. Ta sama zasada, co przy `WAGA_ROZJAZDU`.

**b) Plan potrafił kazać zużyć więcej, niż user ma.** Przy 400 g piersi w lodówce wychodził obiad na 400 g i kolacja na 210 g. Dwie przyczyny, obie naprawione:
- podział zapasu między posiłki działał **tylko dla szablonów**; przepisy skalowały się do pełnego zapasu, każdy niezależnie. Teraz obie ścieżki dzielą to, co **zostało** po wcześniejszych posiłkach (`udzialNaPosilek`),
- licznik zużycia był **raz w gramach** (przepisy), **raz w sztukach** (szablony), a resztki odejmowały to od jednostek koszyka. Stąd „8 jajek z 6" i znikające z listy resztek składniki, których jeszcze zostało. Licznik jest teraz wszędzie w gramach, resztki wracają na jednostkę koszyka.
- doszło przycinanie zaokrągleniem: 118 g piersi zaokrąglone w górę do 120 g to plan, którego user nie wykona.

Zmierzone: przekroczenie zapasu spadło z **12/60 do 0/150** dni.

**c) To samo danie wracało dwa razy w jednym dniu.** `KARA_ZA_POWTORKE` (−10) przegrywała z `BONUS_ZA_PRZEPIS` (+12) i premią za świeżość (×3) — stąd ten sam kurczak na obiad i na kolację. Danie użyte dziś wypada teraz z puli **twardo**, ale tylko gdy jest z czego wybierać: przy pustej lodówce lepiej powtórzyć danie niż zostawić slot pusty.

### Co w tym obszarze dalej boli
- **Przepis skalowany jednym mnożnikiem rozwala makro.** Kotlet drobiowy przeskalowany do celu kcal slotu daje 400 g piersi i **104 g białka w jednym posiłku** (+68%, w skrajnym przebiegu +102%). Kcal trafione co do grama, proporcje w kosmosie. To jest dokładnie TODO 7, tylko po stronie lodówki: silnik ocenia kandydata głównie po kcal, a `WAGA_ROZJAZDU = 1/6` sprawia, że rozjazd 68% kosztuje ~11 pkt, podczas gdy sam bonus za przepis daje +12. Do decyzji świadomej, bo to wprost ta zasada, którą sekcja „dopasowanie makro jest wskazówką" ustala celowo — możliwe wyjścia: podnieść `WAGA_ROZJAZDU`, ograniczyć krotność skalowania przepisu, albo dopuścić dostrajanie elastycznych składników (flaga `elastyczny` z TODO 7).
- **Sufity porcji dalej są wpisane z głowy**, tyle że teraz per składnik, a nie tylko per rola. Warto skalibrować na realnych porcjach.
- **`przeliczPosilek` dostał sufity składnika i porcje typowe**, ale nadal nie wie o `dostepneIlosc` ani o zużyciu w innych posiłkach — user może ręcznie wpisać 300 g piersi w dwóch posiłkach, mając 400 g (to samo, co w punkcie „Korekta nie pilnuje zapasu" w sekcji 10).

## 14. „Dokup i zrobisz" w trybie z lodówki — ZROBIONE, co dalej
Pod planem dnia jest sekcja z 2-3 wylosowanymi przepisami, do których brakuje najwyżej połowy składników („Dokup: mąka pszenna → zrobisz Naleśniki wysokobiałkowe"), i rozwijana lista wszystkich przepisów z brakami („brakuje 4/5"). Mechanika w SPEC.

Zmierzone na koszyku 7 składników (płatki, mleko, banan, jajka, pierś, ryż, pomidor), 3 sloty: 35 przepisów z brakami, od 1/2 do 14/15, wyróżnione różne między przebiegami.

Pomysły na dalej:
- **„Mam to — dodaj do koszyka"** przy brakującym składniku, żeby jednym kliknięciem przeliczyć dzień z tym przepisem.
- **Grupowanie po zakupie** — „dokup mąkę, a otworzą ci się 3 przepisy" byłoby mocniejszą podpowiedzią niż przepis po przepisie.
- **Restrykcje nie docierają do `/api/z-lodowki`** z UI (`KoszykLodowki` ich nie wysyła), więc filtr alergenów w propozycjach dziś działa tylko przez API.
- Długi ogon listy („brakuje 14/15") jest mało użyteczny — do przemyślenia próg albo zwinięcie „reszty".

Przy okazji doszedł przepis `patelnia-yolo-mielone-pieczarki-ziemniaki` (cebula + pieczarki + 400 g mielonego + 300 g ugotowanych ziemniaków + passata, 2 porcje), nowy składnik `pieczarki` (kategoria `warzywo-cieple`) i nowa kategoria zamienników `mieso-mielone` (wołowe / wieprzowe / z szynki / indyk). Przyprawy są tylko w instrukcji, żeby tryb z lodówki nie wymagał papryki w koszyku. Uwaga na wariant wieprzowy: porcja skacze z ~530 do ~780 kcal i 48 g tłuszczu, bo „chude" wieprzowe w bazie ma 21 g tłuszczu/100 g.

Doszła też `turecka-kanapka-kotlety-z-soczewicy` (6 porcji = 12 kotletów, ~650 kcal, B 28 / T 13 / W 107 na porcję) i cztery składniki: `soczewica-zielona`, `bulka-tarta`, `natka-pietruszki`, `pita`. Nowa kategoria zamienników `soczewica` (zielona / czerwona). Oryginał reklamuje się jako „high-protein", ale 28 g białka przy 107 g węgli to raczej danie węglowodanowe — przy ścisłym celu białka warto dołożyć jogurt skyr w sosie. Sumak, ogórki kiszone i zielona papryka są tylko w instrukcji jako opcjonalne (sumaka nie ma w bazie).

## 13. Sprawdzarka bazy (zrobione) i co znalazła
`npm run sprawdz-baze` — opis mechaniki w SPEC. Powstała, bo przy 51 przepisach dopisywanie kolejnych zaczęło grozić trafieniem w coś, co już jest, a błędną referencję do składnika silnik zgłaszał dopiero wyjątkiem w runtime.

Co wyszło od razu po uruchomieniu na obecnej bazie:

- **`nuggetsy-kurczak-pieczone` i `kotlet-drobiowy-owsiany-pieczony` są identyczne w 100%** — ten sam skład (500 g piersi, 1 jajko, 60 g płatków), te same sloty, te same `wymaganeDodatki`, ta sama liczba porcji. Różnią się wyłącznie kształtem i instrukcją (kawałki vs rozbity płat). Do decyzji: zostawić jako dwa różne doświadczenia przy stole, czy scalić — dziś silnik widzi je jako dwóch kandydatów o identycznym makro, więc „różnorodność", którą dają, jest pozorna.
- **`dodatek-ziemniaki-gotowane` i `dodatek-frytki-pieczone` pokrywają się w 96%** — to akurat jest w porządku, oba są dodatkiem skrobiowym z samych ziemniaków i różni je obróbka.
- Cztery naleśniki pokrywają się w 65-76%, co jest oczekiwane: wspólne ciasto, różne nadzienia.

Czego sprawdzarka jeszcze nie robi, a mogłaby:
- **Nie widzi szablonów z `data/szablony.json`** — nie sprawdza, czy każda rola użyta w gnieździe ma w bazie choć jeden składnik, ani czy każdy slot ma czym się wypełnić przy typowym koszyku.
- **Nie sprawdza sensu kulinarnego**, tylko strukturę — „kanapka z ryżem" przeszłaby, gdyby ktoś taki przepis wpisał. Od tego są szablony, ale przepisów nikt nie pilnuje.
- **Nie jest wpięta w `next build`** ani w żaden hook. Świadomie, bo to narzędzie do ręcznego odpalania przy edycji danych — ale `--strict` jest gotowe pod CI, gdyby kiedyś było.
