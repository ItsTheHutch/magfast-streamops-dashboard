# magFAST StreamOps Dashboard

A browser-based dashboard for running the [magFAST](https://horaro.net/magfast) charity speedrun marathon stream. It runs on the OBS PC, and operators open it in a web browser on the same network.

What it does (✅ done, 🚧 planned):

- 🚧 Edit the current segment, up to 4 performers, and the next segment, writing them to text files that OBS text sources read
- 🚧 Segment timer with a finish button per performer, shown in OBS as a browser source
- 🚧 Import the run order from Horaro, so operators click **Load**, check the fields and click **Save**
- 🚧 Omnibar browser source: rotating logos, an info ticker and the Tiltify donation total
- 🚧 Update the Twitch stream title and category

## Requirements

- [Node.js](https://nodejs.org/) 26 or newer

## Getting started

```bash
npm install
npm start
```

Then open <http://localhost:3000>. Other machines on the network can use `http://<obs-pc-ip>:3000`.

`npm run dev` restarts the server automatically when files change. `npm test` runs the tests.

## Configuration

The defaults live in `config/config.example.json`. To change any of them, copy that file to `config/config.json` and edit the copy. `config/config.json` is gitignored because it holds API secrets, and it only needs the keys you're changing.

| Key | Purpose |
|---|---|
| `port`, `host` | Where the server listens (default `0.0.0.0:3000`, which allows LAN access) |
| `password` | Optional shared password for the dashboard. Overlays stay open so OBS can load them. |
| `outputDir` | Folder that OBS text files are written to. Relative paths are resolved from the project folder. |
| `dataDir` | Folder for saved state, the performer directory, logos and tokens |
| `horaro` | Event and schedule slugs (`magfast` / `2027`), an optional hidden-column key, and the column-name mapping |
| `tiltify` | Campaign ID and API credentials for the donation total and incentives |
| `twitch` | App credentials for updating the stream title and category |

## Running on the OBS PC (Windows)

Clone the repo on Windows, run `npm install` and `npm start` in PowerShell, and point OBS at it:

- **Text sources:** Text (GDI+) → *Read from file* → a file in `outputDir`
- **Browser sources:** `http://localhost:3000/overlay/...`

## Project layout

```
config/          configuration (example + your local overrides)
src/             server code
public/dashboard dashboard web UI
public/overlay   OBS browser-source pages
test/            node:test unit tests
data/, output/   created at runtime (gitignored)
```
