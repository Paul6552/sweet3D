# Sweet3D

Selbst gehostete Web-Version von [Sweet Home 3D](https://www.sweethome3d.com):
React-Frontend, Quarkus-Backend, PostgreSQL und Keycloak, alles in eigenen Containern.

| Ordner | Inhalt |
|---|---|
| `frontend/` | Vite + React 19 + TypeScript, MUI, TanStack Router, zustand, immer, keycloak-js |
| `backend/` | Quarkus 3.40 (Java 21), REST-API, Flyway, OIDC; nutzt `SweetHome3D.jar`, `Furniture.jar`, `Textures.jar` (in `backend/libs`) |
| `docker/` | Init-Skript für Postgres (Datenbanken `sweet3d`, `keycloak`, `sweet3d_test`), Keycloak-Realm `sweet3d` |

## Container

Alle Container gehören zum Compose-Projekt `sweet3d` und teilen sich nichts mit anderen Projekten.

| Container | Port (nur localhost) | Zweck |
|---|---|---|
| `sweet3d-postgres` (postgres:18) | 5442 | Daten der App **und** von Keycloak (getrennte DBs und Benutzer) |
| `sweet3d-keycloak` (26.8.1) | 8190 | Login, Realm `sweet3d`, Admin-Konsole unter `/admin` |
| `sweet3d-backend` (Profil `prod`) | 8180 | Quarkus mit eingebautem Frontend |

Zugangsdaten liegen in `.env` (nicht versioniert, Vorlage: `.env.example`).
Testnutzer im Realm: `alice` / `alice` und `bob` / `bob`.

## Entwicklung

```bash
docker compose up -d sweet3d-postgres sweet3d-keycloak
cd backend  && ./mvnw quarkus:dev          # http://localhost:8180 (API)
cd frontend && npm install && npm run dev  # http://localhost:5173 (leitet /api an 8180 weiter)
```

Tests: `cd backend && ./mvnw test` (nutzt die Datenbank `sweet3d_test`), `cd frontend && npm run build && npm run lint`.

## Produktion

```bash
docker compose --profile prod up -d --build   # http://localhost:8180
```

Für den Betrieb im Internet:
- Einen HTTPS-Reverse-Proxy davorschalten.
- In `docker-compose.yml` `KC_HOSTNAME` und `QUARKUS_OIDC_TOKEN_ISSUER` auf die öffentliche Keycloak-URL setzen.
- Im Realm die Redirect-URIs des Clients `sweet3d-frontend` anpassen und `frontend/.env.production` entsprechend ändern.
- Keycloak läuft hier noch im Modus `start-dev`; für den Internetbetrieb auf `start` mit HTTPS umstellen.

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

- [x] Phase 1: Gerüst, Login, Projektverwaltung, Autosave mit Konflikterkennung, abdockbare Panels
- [x] Phase 2: Möbel- und Texturkatalog (aus den Original-JARs, mehrsprachig), Katalog-Panel mit Suche und Drag & Drop
- [x] Phase 3: 2D-Planeditor (Wände mit Gehrung und Magnetismus, Räume inkl. automatischer Erkennung, Möbel verschieben/drehen/skalieren, Türen/Fenster rasten in Wände ein, Kopieren/Einfügen)
- [x] Phase 4: 3D-Ansicht (react-three-fiber: Wände mit Tür-/Fensteröffnungen, Böden, Möbelmodelle, Luftansicht und virtueller Besucher)
- [ ] Phase 5: `.sh3d`-Import/-Export, Vorschaubilder

## Lizenz

Sweet Home 3D und die mitgelieferten Kataloge stehen unter der GNU GPL (siehe `COPYING.TXT` der Desktop-Distribution).
Wer Sweet3D Dritten anbietet, muss den Quellcode ebenfalls unter der GPL bereitstellen.
