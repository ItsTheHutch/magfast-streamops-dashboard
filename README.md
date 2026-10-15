# magFAST StreamOps Dashboard

A browser-based dashboard for running the [magFAST](https://horaro.net/magfast) charity speedrun marathon stream. It runs on the OBS PC, and operators open it in a web browser on the same network.

What it does (✅ done, 🚧 planned):

- ✅ Edit the current segment, up to 4 performers, and the next segment, writing them to text files that OBS text sources read
- ✅ Performer directory: pronouns and socials saved once and filled in automatically by name
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

## Using the dashboard

**Run tab.** Fill in the current segment, performers and up next. Changed fields are outlined in gold until you click **Save** (or press Ctrl+S). Saving rewrites the OBS text files and updates every open dashboard. **Revert** discards unsaved edits. If another operator saves while you're editing, only the fields you haven't touched update.

Typing or picking a name that's in the performer directory fills in that performer's pronouns and socials. Names that aren't in the directory get a **Not in directory** badge, and **Save to directory** adds them.

**Performers tab.** Add, edit and delete directory entries. Handles can be pasted as `@name` or as a full profile URL; they're cleaned up to just the handle.

## OBS text files

These files are written to `outputDir` on every save. Unused fields are written as empty files, so OBS shows nothing.

| File | Contents |
|---|---|
| `current_name.txt`, `current_category.txt`, `current_estimate.txt` | Current segment |
| `performer1_name.txt` … `performer4_name.txt` | Performer names |
| `performerN_pronouns.txt` | Pronouns |
| `performerN_social.txt` | Social with its site, e.g. `twitch.tv/BlazeBops`, `youtube.com/@name` |
| `performerN_handle.txt` | Just the handle (`BlazeBops`, `@name`), for layouts with a platform icon |
| `next_name.txt`, `next_category.txt`, `next_estimate.txt`, `next_performers.txt` | Up next |

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
