# Selvstændig webeksport

Brug **Export Web Game** i editoren for at hente en ZIP med `index.html` og en separat player-runtime i `game.js`. Udpak ZIP-filen. Åbn `index.html` direkte, eller upload begge filer til en statisk webhost. Scene, kompilerede TypeScript-filer, nodegrafer, atlasser og assets ligger indlejret i HTML-filen, så eksporten ikke skal hente projektdata eller assets over netværket.

Eksporten bruger relative stier og kan derfor ligge både på webstedets rod og i en undermappe. Spillet kræver en browser med WebGL 2 og Web Audio. Browseren låser lyd indtil spilleren trykker Play. Eksporten indeholder ikke editoren eller Monaco.

Runtime-komponenterne, kodebaserede scripts, nodegrafer, fysik, tilemaps, animation, lyd og spil-UI er med i eksporten. Runtime-plugins kan ikke eksporteres endnu; editoren afviser eksport, hvis scenen indeholder komponenter fra et plugin. Plugin-kode bliver ikke kopieret med i eksporten.

`game.js` er en klassisk browserbundle, så den også kan indlæses fra `file://`; projektets JSON-data og assets ligger som indlejret JSON/data-URL'er i `index.html`. Eksporten er ikke en krypterings- eller kodebeskyttelsesmekanisme. Ret i projektet og eksportér igen for at udgive en opdatering.

Eksporten indeholder alle projektscener og starter den valgte Start scene fra Project Settings. Camera 2D og Game View (Free/Fit, referenceopløsning og letterboxing) bruges på samme måde som i editorens Play mode. Sceneovergange bruger `scene.load` med `{ sceneId }` fra kode eller nodegrafer.
