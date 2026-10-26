# PS Party

Menüleisten-App für macOS, mit der du PlayStation-Party-Voice-Chats am Mac
nutzt, ganz ohne PS4 oder PS5.

## Wie das funktioniert (und warum so)

Sony hat keinen Party-Chat-Client für macOS oder Windows. Das
Party-Protokoll ist nicht öffentlich dokumentiert, und es gibt auch kein
funktionierendes Open-Source-Reverse-Engineering davon. Ein eigener
"echter" Client ist deshalb nicht realistisch, und mit inoffiziellem
Netzwerkverkehr würdest du außerdem eine PSN-Sperre riskieren.

Ohne Konsole geht Party-Voice offiziell nur über die **PlayStation App**
fürs Handy. PS Party lässt genau diese offizielle Android-App am Mac
laufen, und zwar in Googles eigenem Android-Emulator (auf Apple Silicon
läuft der nativ, ohne Übersetzung). Die App steuert das komplett im
Hintergrund: Klick in der Menüleiste, Android fährt hoch, die
PlayStation App geht auf, und dein Mac-Mikrofon und deine Lautsprecher
werden durchgereicht.

Alternativen, die ich mir angeschaut und verworfen habe:

- **PS Remote Play für Mac**: offiziell, braucht aber eine Konsole.
- **iPhone-Synchronisierung (iPhone Mirroring)**: gibt kein Mikrofon an
  iPhone-Apps weiter und ist in der EU nicht verfügbar.
- **iOS-PlayStation-App auf Apple Silicon**: nicht offiziell für den Mac
  freigegeben. Der Umweg über PlayCover braucht eine entschlüsselte IPA
  aus fragwürdigen Quellen.
- **BlueStacks & Co.**: funktioniert grundsätzlich, ist aber schwerer,
  enthält Werbung und lässt sich nicht so sauber steuern.

## Voraussetzungen

- macOS 13 oder neuer, am besten ein Apple-Silicon-Mac (M1 oder neuer)
- [Homebrew](https://brew.sh)
- Xcode Command Line Tools (`xcode-select --install`) zum Bauen
- ca. 8 GB freier Speicher
- ein Google-Konto (für den Play Store) und dein PSN-Konto

## Installation

```bash
cd PSParty
./Scripts/make_app_bundle.sh
mv "dist/PS Party.app" /Applications/
open "/Applications/PS Party.app"
```

Beim ersten Start ist die App noch nicht eingerichtet:

1. Menüleiste → Controller-Symbol → **Einrichtung starten…**. Es öffnet
   sich ein Terminal, das Java, die Android-Kommandozeilentools, den
   Emulator und ein Android-14-Image mit Play Store installiert. Die
   Google-Lizenzen musst du dort selbst mit `y` bestätigen.
2. **Party starten**. Beim ersten Start meldet sich macOS wegen des
   Mikrofons, bitte erlauben.
3. Im Android-Fenster mit deinem Google-Konto im Play Store anmelden und
   die **PlayStation App** installieren (die Seite geht automatisch auf).
4. PlayStation App öffnen, mit dem PSN-Konto anmelden, Party beitreten.

Ab dann reicht **Party starten**: Android bootet per Quick Boot in ein paar
Sekunden, und die PlayStation App öffnet sich direkt.

## Menü

- **Party starten / PlayStation App öffnen**: fährt Android hoch, falls
  nötig, und öffnet die App (⌘P)
- **Mikrofon an Party senden**: schaltet das Mac-Mikrofon für die Party an
  und aus (⌘M). Das Menüleisten-Symbol zeigt ein durchgestrichenes Mikro,
  wenn du stumm bist.
- **Fenster zeigen**: holt das Android-Fenster nach vorne
- **Party beenden**: fährt Android herunter
- **PS Party beenden**: beendet auch Android

## Bekannte Risiken, bitte am Mac prüfen

Gebaut ohne Zugriff auf einen Mac, deshalb ist das hier **noch nicht
getestet**. Am ehesten muss hier nachgebessert werden:

1. **Mikrofon im Emulator.** Neuere Emulatoren schalten Host-Audio aus
   Datenschutzgründen stumm. Die App setzt `-allow-host-audio` (nur wenn
   der installierte Emulator das Flag kennt) und schickt nach dem Boot
   `avd hostmicon` an die Emulator-Konsole. Wenn dich trotzdem niemand
   hört: im Emulator-Fenster `…` → *Microphone* → "Virtual microphone uses
   host audio input" einschalten.
2. **Erkennt die PlayStation App den Emulator?** Party-Voice in Emulatoren
   wird online berichtet (z. B. BlueStacks), garantiert ist das nicht. Falls
   Sony Emulatoren blockiert, ist dieser Weg zu.
3. **Echo.** Ohne Headset hören die anderen sich eventuell selbst. Mit
   Kopfhörern spielen.
4. **Akku und RAM.** Der Emulator belegt ca. 4 GB RAM, solange er läuft.

## Rechtliches

Nutzt ausschließlich offizielle Software: Googles Android-Emulator und die
PlayStation App aus dem Play Store. Es wird kein PSN-Verkehr abgefangen
oder nachgebaut.
