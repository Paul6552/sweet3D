# Sweet3D

Web-Version von [Sweet Home 3D](https://www.sweethome3d.com), die komplett im Browser läuft:
kein Server, kein Login, keine Datenbank. Projekte liegen im `localStorage` des Browsers und lassen sich als
`.sh3d` herunterladen und mit der Desktop-App austauschen.

| Ordner | Inhalt |
|---|---|
| `frontend/` | Vite + React 19 + TypeScript, MUI, TanStack Router, zustand, immer, Konva (2D), react-three-fiber (3D), fflate (ZIP) |
| `frontend/vendor/sh3d/` | `Furniture.jar`, `Textures.jar`, `SweetHome3D.jar` aus der Sweet Home 3D 7.5 Distribution |
| `frontend/scripts/build-catalog.mjs` | erzeugt daraus den Katalog als statische Dateien in `frontend/public/catalog` |

## Entwicklung

```bash
cd frontend
npm install
npm run dev     # http://localhost:5173, erzeugt vorher den Katalog
npm run build   # statische Seite in dist/
npm run lint
```

`npm run catalog` erzeugt den Katalog neu (nur nötig, wenn die JARs in `vendor/sh3d` ersetzt werden;
`dev` und `build` erledigen das automatisch, sobald sich etwas geändert hat).

## Selbst hosten

`frontend/dist` ist eine statische Seite und läuft auf jedem Webserver. Für die Adressen `/editor/...`
muss der Server unbekannte Pfade mit `index.html` beantworten (siehe `frontend/nginx.conf`).

Mit Docker (nginx):

```bash
docker compose up -d --build   # http://localhost:8180
```

## Projekte und Dateien

- Beim Öffnen startet direkt der Editor mit dem zuletzt bearbeiteten Projekt (beim ersten Mal mit einem neuen).
- Über das Ordner-Symbol oben links: Projekte anlegen, öffnen, umbenennen, duplizieren, löschen und `.sh3d` importieren.
- Änderungen werden automatisch im Browser gespeichert. Der `localStorage` fasst je nach Browser etwa 5 MB;
  die Belegung steht im Projektdialog. Ist er voll, erscheint ein Hinweis.
- Herunterladen als `.sh3d` über das Download-Symbol in der Werkzeugleiste oder im Projektdialog.
  Die Datei enthält `Home.xml` und die Modelle und öffnet sich in Sweet Home 3D ab Version 5.3.
- Import: Dateien aus Sweet Home 3D ab 5.3. Möbel aus dem Standardkatalog nutzen dessen Modelle, andere Modelle
  werden ins Projekt übernommen (OBJ). Bei mehreren Ebenen wird nur die unterste übernommen.
- Die Daten gehören zum Browser und zur Adresse der Seite: ein anderer Browser oder Rechner sieht sie nicht.
  Zum Sichern oder Weitergeben `.sh3d` herunterladen.

## Ansichten auf mehreren Bildschirmen

Jedes Panel (Möbelkatalog, Möbelliste, Plan, 3D-Ansicht) lässt sich über das Symbol ↗ in ein eigenes Fenster
lösen, z. B. 2D-Plan auf Bildschirm 1 und 3D-Ansicht auf Bildschirm 2.

- In Chrome und Edge fragt die App einmalig nach der Berechtigung *Fensterverwaltung* und bietet dann den
  Zielbildschirm an. Position und Größe jedes Fensters werden gemerkt.
- Die Fenster synchronisieren sich über `BroadcastChannel`. Das Hauptfenster führt alle Änderungen aus,
  speichert automatisch und verteilt sie als immer-Patches. Undo/Redo (Strg+Z / Strg+Y) funktioniert in jedem Fenster.
- Wird ein Panel-Fenster geschlossen oder über ↙ zurückgeholt, erscheint das Panel wieder im Hauptfenster.
  Nach einem Neuladen bietet die Werkzeugleiste „Fenster wiederherstellen“ an.

## Stand und Fahrplan

- [x] Gerüst, Projektverwaltung im Browser, Autosave, abdockbare Panels
- [x] Möbel- und Texturkatalog (aus den Original-JARs, mehrsprachig), Katalog-Panel mit Suche und Drag & Drop
- [x] 2D-Planeditor (Wände mit Gehrung und Magnetismus, Räume inkl. automatischer Erkennung, Möbel verschieben/drehen/skalieren, Türen/Fenster rasten in Wände ein, Kopieren/Einfügen)
- [x] 3D-Ansicht (react-three-fiber: Wände mit Tür-/Fensteröffnungen, Böden, Möbelmodelle, Luftansicht und virtueller Besucher)
- [x] `.sh3d`-Import und -Download
- [ ] Ebenen, Maßlinien und Texte, Eigenschaftsdialoge (Farben, Texturen), Vorschaubilder

## Lizenz

Sweet Home 3D und die mitgelieferten Kataloge stehen unter der GNU GPL (siehe `COPYING.TXT` der Desktop-Distribution).
Wer Sweet3D Dritten anbietet, muss den Quellcode ebenfalls unter der GPL bereitstellen.
