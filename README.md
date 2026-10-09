# hutek-visibility — suivi de la visibilité Hutek dans le Mode IA de Google

Application + collecte quotidienne : 13 questions versionnées (A1–A7 avec Hutek, B1–B6 sans Hutek),
audit séquentiel via Selenium distant, analyse déterministe, rapport quotidien en français, interface protégée.

## Architecture

- **App Node/Express** (`server.js`, zéro dépendance hors `express`) : API d'audits (démarrage async,
  verrou anti-doublon, idempotence par `dateKey`, reprise), analyse, rapports, UI statique.
- **Collecteur** (`lib/collector.js`) : pilote le navigateur distant via le protocole WebDriver
  (HTTP brut). Une navigation fraîche par question = une conversation Google indépendante.
  Aucune réponse inventée : statuts explicites (`ok_complete`, `incomplete`, `bloquee`, `echec_technique`).
- **Analyse** (`lib/analyze.js`) : règles explicables (mention / recommandation / position /
  `hutek.fr` en sources / concurrents heuristiques). Taux calculés **uniquement** sur le groupe B
  réussi et complet, avec numérateurs, dénominateurs et échecs affichés.
- **Rapport** (`lib/report.js`) : synthèse, observations, changements vs audit précédent, limites, actions.
  Chaque conclusion renvoie aux IDs de recherche et extraits.
- **Données** : `DATA_DIR` (volume persistant `/app/data`) : `audits.json`, `audits/<id>/{meta,results,report}.json`,
  `report.html` autonome (captures embarquées), `screenshots/<QID>.png`.

## API

- `GET /api/health` (public, healthcheck), `GET /api/config` (questions versionnées)
- `POST /api/audits/start` `{dateKey?, force?}` → `{auditId, status|reused}` (jeton admin ou utilisateur connecté ; 409 si déjà en cours)
- `POST /api/audits/:id/resume` (reprise, préserve les questions collectées)
- `GET /api/audits` · `GET /api/audits/:id/status` · `GET /api/audits/:id`
- `GET /api/audits/:id/report` (JSON) · `.../report.html` (autonome) · `.../export.json`
- `GET /screenshots/:auditId/:file` (captures servies par l'app)

## Variables d'environnement

| Var | Rôle |
|---|---|
| `PORT` | écoute (3000) |
| `DATA_DIR` | persistance (`/app/data`, volume Dokploy `hutek-visibility-data`) |
| `SELENIUM_URL` | navigateur distant (`http://10.0.1.153:4444`) |
| `ADMIN_TOKEN` | jeton serveur pour n8n (en-tête `x-admin-token`), hors dépôt |
| `UI_USER` / `UI_PASS` | basic auth de l'interface (hors dépôt) |
| `COLLECT_DELAY_MS` / `COLLECT_WAIT_MS` | temporisation / délai max par question |

## Workflow n8n `hutek-visibility-quotidien`

Déclenchement **Schedule 8 h, fuseau Europe/Paris** (paramètre du workflow) + exécution manuelle.
Chaîne : `Demarrer audit` (POST idempotent par date du jour) → `Attendre 25 min` → `Lire statut` →
`Lire rapport` → `Synthese`. La tâche longue tourne côté app (pas de timeout HTTP) ; n8n suit
l'état jusqu'au résultat. Échecs explicites (statuts d'audit, audits partiels repris via `/resume`).

## Déploiement (Dokploy)

- Application `hutek-visibility` (projet `opencode-apps`), source GitHub `hutek-ai/hutek-visibility`, build Dockerfile.
- Volume `hutek-visibility-data` → `/app/data` (survit aux redéploiements, vérifié).
- Domaines : `visibility.hutek.fr` (nécessite un enregistrement A vers 51.77.218.139 à ajouter chez
  le registrar — pas de wildcard) + domaine généré
  `app-input-neural-array-a4yacw-c59120-51-77-218-139.sslip.io` (opérationnel).
- Dépôt GitHub public (code uniquement, aucun secret) car le connecteur GitHub Dokploy
  ne voit pas les dépôts privés créés après son installation.

## Limites connues (honnêtes)

- Google limite le rythme automatisé (page `/sorry` observée le 09/10 après ~14 requêtes en 20 min) :
  détection explicite (`bloquee`), sans contournement. Le rythme quotidien (13 req/j) est hors de ce cas.
- Session Selenium unique partagée (`maxSessions: 1`) : un seul audit à la fois (verrou serveur + 409).
- Compte et géolocalisation Google non vérifiables depuis la session partagée (enregistré comme tel).
- Concurrents extraits par heuristique documentée (indicatifs, non exhaustifs).
- Pas de score global de réputation : observations du Mode IA dans les conditions testées uniquement.

## Lancer / tester

```
npm install
npm test          # unitaires (protocole, analyse, secrets)
PORT=3000 DATA_DIR=./data node server.js
```
