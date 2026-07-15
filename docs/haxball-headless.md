# Pokój HaxBall headless 24/7 (Opcja 2)

Host pokoju działający bez przeglądarki, na małym serwerze (VPS). Sam hostuje grę i wysyła
wyniki do Pitole (`POST ?r=ingest`). Daje pełne dane: składy, gole, **strzelca i asystę**,
samobóje, zwycięzcę. Backend auto-linkuje mecz do aktywnego turnieju i wpisuje wynik.

Pliki: [`bot/host.js`](../bot/host.js), [`bot/package.json`](../bot/package.json),
[`bot/env.example.txt`](../bot/env.example.txt), [`bot/ecosystem.config.js`](../bot/ecosystem.config.js).

> Apka Pitole (pitole.pl) musi już działać — patrz [`deployment-ovh.md`](deployment-ovh.md).
> **Hosting współdzielony OVH nie uruchomi tego** (brak długożyjącego procesu Node) — potrzebny VPS.

## 1. Serwer

Dowolny VPS z Linuksem (OVH VPS, Hetzner CX11, Oracle Free Tier itp.), 1 vCPU / 512MB+ starcza.
Zainstaluj Node 18+:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. Kod + zależności

```bash
git clone <repo> pitole && cd pitole/bot
npm install            # pobiera node-haxball
```
Jeśli przy starcie błąd ładowania `node-datachannel`:
```bash
npm rebuild node-datachannel
```

## 3. Konfiguracja

```bash
cp env.example.txt .env
nano .env
```
Ustaw:
- `HAX_TOKEN` — pobierz z https://www.haxball.com/headlesstoken (przepisz recaptcha).
  **Token wygasa** — po każdym restarcie hosta trzeba wpisać nowy. Recaptcha = tego nie da
  się w pełni zautomatyzować (znane ograniczenie HaxBalla).
- `BACKEND_URL=https://pitole.pl`
- `ROOM_NAME`, `ROOM_PUBLIC`, `ROOM_PASSWORD`, `MAX_PLAYERS` — wg uznania.

## 4. Test ręczny

```bash
npm start
```
W logu powinno być `[host] pokój wstał: "..."`. Wejdź do pokoju (lista / link), zagraj mecz do
zwycięstwa. Cel:
```
[mecz] start. red=[...] blue=[...]
[gol] team=red strzelec=... asysta=... ...
[mecz] zwycięstwo: red
[mecz] zapisany. id=... counted=true linked=...
```
`linked=<id>` = wynik wpisał się meczowi aktywnego turnieju. `linked=null` = tylko statystyki.

## 5. 24/7 (pm2)

```bash
sudo npm i -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup        # wykonaj polecenie które wypisze (autostart po reboocie)
```
Log: `pm2 logs pitole-host`. Restart po zmianie tokenu: `pm2 restart pitole-host`.

## Uwagi

- Pierwszy wchodzący gracz dostaje **admina** (może ruszać składy i startować mecze); po jego
  wyjściu admin przechodzi na kolejnego.
- Host **nie gra** (`noPlayer`) — nie zajmuje slotu drużyny.
- Rozłączenie → auto-reconnect co 5 s. Wygasły token → w logu prośba o nowy.
- POST idzie serwer-do-serwera (bez CORS). `?r=ingest` jest bez auth — nie rozgłaszaj adresu
  publicznie jeśli to problem.
- Nicki w HaxBall muszą pasować do nazw graczy w turnieju, by auto-link zadziałał. Rozjazdy
  scalisz w Pitole → Statystyki → Aliasy.
```
