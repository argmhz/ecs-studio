# Deling og import af projekter

Et `.ecsproj` er et selvstændigt, versionsmærket projektarkiv. Det indeholder scenen, scripts, nodegrafer, prefabkilder, atlasmetadata og de importerede assetbytes. Dermed behøver modtageren ikke kopiere en separat assets- eller scripts-mappe.

## Flyt et projekt

1. I editoren: vælg **Export Project** og gem `.ecsproj`-filen.
2. Overfør filen til den anden computer.
3. Åbn ECS Studio, vælg **Open Project**, og vælg arkivet. Editorens browserlager får et nyt projekt-ID; projektet, som allerede var åbent, bliver ikke overskrevet.

Projektfiler indeholder spillets scripts og assets. Del kun arkiver, du har tilladelse til at dele. Hostingcredentials bør aldrig gemmes i projektfiler.

## Formatopgraderinger og fejl

Importen validerer filen og migrerer ældre projektversioner i hukommelsen til den aktuelle version. Den valgte `.ecsproj` ændres ikke; gem eller eksportér den migrerede udgave som en ny fil, hvis den skal deles videre. Arkiver fra en nyere, ikke-understøttet formatversion afvises, så de skal åbnes med en kompatibel, nyere editor.

Importerede komponenter skal have et schema, som editoren kender. Hvis en scene bruger en plugin-komponent, som ikke er registreret, forklarer importfejlen komponent-ID'et og beder om det kompatible plugin. Indlæs plugin'et og importér filen igen. Assets, som refereres af scenen eller prefabkilder, men mangler i arkivet, afvises med det manglende stabile asset-ID.

Import afbrydes før aktivt projekt skiftes, hvis arkivet eller scenen ikke kan læses. Det eksisterende projekt forbliver tilgængeligt. En afbrudt lagring kan efterlade ubrugt lokal browserdata, men ændrer ikke arkivfilen.

## Test

Round-trip, ældre formatversioner, ugyldige assets, atlasreferencer, prefabs, scripts og nodegrafer dækkes af `npm run test:editor-unit`. Den manuelle browsermatrix for `.ecsproj` import/eksport er beskrevet i [ADR 0034](decisions/0034-browser-support-and-performance-budgets.md).
