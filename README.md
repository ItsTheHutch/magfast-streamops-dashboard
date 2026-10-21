# magFAST StreamOps Dashboard

A browser-based dashboard for running the [magFAST](https://horaro.net/magfast) charity speedrun marathon stream. It runs on the OBS PC, and operators open it in a web browser on the same network.

What it does (✅ done, 🚧 planned):

- ✅ Edit the current segment, up to 4 performers, and the next segment, writing them to text files that OBS text sources read
- ✅ Performer directory: pronouns and socials saved once and filled in automatically by name
- ✅ Speedrun timer on the Dashboard, with a finish button per runner for races of up to 4, and an uploadable timer font
- ✅ The timer as an OBS Browser source
- ✅ Import the run order from Horaro, show it on Schedule, and fill Edit Segment from it
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
| `horaro` | Default Horaro schedule (`magfast` / `2027`), hidden-column key and column names. The Settings tab overrides these. |
| `tiltify` | Campaign ID and API credentials for the donation total and incentives |
| `twitch` | App credentials for updating the stream title and category |

## Using the dashboard

**Dashboard tab.** Opens by default. On the left is the saved Live Segment, meaning what's on stream rather than unsaved edits, with a compact list of its performers (only the slots that are filled in). The saved Next Segment is shown the same way underneath. On the right is the speedrun timer.

- **Promoting from the Dashboard:** tick **Next Segment is ready to go live** to enable **Move to Live**. It does the same as the button on Edit Segment: it saves straight away, the first future run moves up into Next Segment, and **Undo move** works from either tab. Afterwards the checkbox clears.
- **When the checkbox is unavailable:** it's disabled, with the reason shown, while Edit Segment has unsaved changes or Next Segment isn't ready. A tick clears if Next Segment changes after you ticked it.

- **Timer controls:** **Start**, **Pause**, **Resume** and **Reset**. Reset asks first.
- **Finishing a run:** the timer's own **Finish** button stops it, and **Undo finish** carries on as though it never stopped.
- **Race Mode** appears when the Live Segment has two or more performers, and it's off by default. A single performer is never a race, and co-op runs can leave it off. Turning it on swaps the timer's Finish button for one **Finish** button per runner. Each runner's time and placing are recorded, with placings shown in gold, silver, bronze and steel blue, and the timer stops when the last runner finishes. **Undo finish** reopens a runner.
- **Locking and reset:** Race Mode can't be switched while any finish time is recorded. **Reset** turns it back off.
- **Shared and saved:** every open dashboard shows the same timer, and it's saved in `data/state.json`, so it survives a server restart.
- **Moving to a new segment** doesn't reset the timer. Reset it when the next run starts.

**Edit Segment tab.** The tab has three parts:

- **Live Segment** is what's on stream now.
- **Next Segment** is where you set up the next segment while the live one runs.
- **Future runs** lists the four runs after that. They're shown on the break scene.

Every segment and future run needs a **Segment type**, either **Core Content** or **Host/Interstitial**, before it can be saved. The Live Segment panel is tinted teal for Core Content or lavender for Host/Interstitial, and both segments show their type in the top-right corner.

Changed fields are marked in amber until you click **Save** (or press Ctrl+S). Saving rewrites the OBS text files and updates every open dashboard. **Revert** discards unsaved edits. If another operator saves while you're editing, only the fields you haven't touched update.

**Move Next Segment to Live** asks you to confirm, then saves straight away:

- Next Segment goes live.
- The first future run moves into Next Segment. Its performer names are split on `vs`, `,`, `&`, `+` and `and`, then looked up in the directory.
- The other future runs move up a row.

**Undo move** puts everything back as it was, including any unsaved edits you had. It stays available until the next save.

Estimates are always saved as `H:MM:SS`. They're typed left to right like a date: `1`, `3`, `0` gives `1:30:00`. The cursor skips the colons, typing `:` jumps to the next part, and a minutes or seconds digit over 5 becomes `0X` (`1`, `7` gives `1:07:00`). Backspace zeroes the digit before the cursor.

A segment can have one to four performers. Unused slots stay empty, with Social set to **Not set**. Pasting a Twitch, YouTube or Kick profile link into **Handle or URL** sets the platform for you.

Typing or picking a name that's in the performer directory fills in that performer's pronouns and socials. Names that aren't in the directory get a **Not in directory** badge, and **Save to directory** adds them.

**Schedule tab.** Shows the imported Horaro schedule, grouped by day.

- **Top of the page:** when the schedule was last checked, when it last changed on Horaro, and when the next check is. **Refresh schedule** checks straight away. If a check fails, the last good copy stays on screen with the error above it.
- **Cancelled runs** (names containing `[CANCELLED]`) are struck through and skipped when Edit Segment is filled.
- **Load as Next** on a run puts it in Next Segment and the four runs after it in Future runs, saved straight away. From then on Edit Segment follows the schedule.
- **While following:** moving a segment to Live pulls the next run into the last Future runs row. When Horaro changes, Next Segment and Future runs rows you haven't edited by hand update. Rows you've edited are kept, and the Live Segment is never changed. The rows in Edit Segment are marked Live, Next and Future run 1–4.
- **Stop following** leaves the rows as they are.

**Performers tab.** Add, edit and delete directory entries. Handles can be pasted as `@name` or as a full profile URL; they're cleaned up to just the handle. The stream title (planned) tags each performer with their social handle, whatever the platform, unless it's a link such as a website.

**Settings tab: Horaro schedule.**

- **Address and hidden key:** the schedule's address, like `https://horaro.net/magfast/2027`, and the hidden-column key if the schedule has hidden columns.
- **Columns:** which Horaro column holds the segment name, category, performers and segment type.
- **Segment type:** a segment is Host/Interstitial when its segment type column contains a word you choose, `Interstitial` by default, and Core Content otherwise.
- **Categories:** an option removes the `Speedrun - ` and `Interstitial - ` prefixes from categories.
- **Checks:** how often to check for changes, every 5 minutes by default.
- **Where it's kept:** the last imported schedule is saved in `data/schedule.json`, so it's still there after a restart or without internet.
- **Reset schedule data** (red) deletes the imported schedule and puts these settings back to their defaults. Edit Segment stops following the schedule but keeps its rows.

**Settings tab: timer font.** Upload a `.woff2`, `.woff`, `.ttf` or `.otf` file of up to 10 MB to use for the timer. The file is kept in `data/fonts/`. **Use default font** switches back.

**Settings tab: timer for OBS.** This shows the timer page's address with a **Copy** button. In OBS, add a **Browser** source with that address, for example `http://localhost:3000/overlay/timer.html` on the OBS PC.

- **What it shows:** just the clock, on a transparent background, in the timer font. It fills whatever size you give the source and stays in step with the Dashboard.
- **Changing its look:** use the Browser source's **Custom CSS**, for example `.clock { color: gold; text-align: left; }`.
- **Status:** the page's `body` has `data-status="stopped|running|paused|finished"`, so you can style each state.

**Settings tab: OBS text files.** Sets where each OBS text file is written, grouped the same way as Edit Segment.

- **Output folder:** leave it blank to use `outputDir` from the config.
- **File locations:** each field's location can be a file name, a path relative to the output folder, or a full path, and must end in `.txt`. Fields that repeat per performer or future run use `{n}` for the number.
- **When you save:** the files are written to their new locations straight away, and files at the old locations are left alone.
- **Where settings are kept:** `data/settings.json`.

**Settings tab: NUCLEAR RESET.** **Reset All Data** (at the very bottom) erases all data and settings, back to a fresh install.

- **Erased:** every performer, the Live Segment, Next Segment, Future runs, the timer, the imported schedule, the Horaro settings, the output folder, the file locations and the uploaded timer font.
- **Blanked:** every OBS text file, Core and Host alike, at both the old and the default locations.

**Backups for both resets:** they ask for confirmation first, with Cancel selected by default. They copy the data files, and the timer font, into `data/backups/<date-time>-<reason>/` before changing anything. To undo a reset, stop the server, copy the files from that folder back into `data/`, and start it again.

The section's background photo is the 1954 Castle Bravo test, a public-domain US Department of Energy photo from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Castle_Bravo_Blast.jpg).

## OBS text files

These are the default file names. You can change them on the **Settings** tab. The files are rewritten on every save, and unused fields are written as empty files, so OBS shows nothing.

| File | Contents |
|---|---|
| `current_name.txt`, `current_category.txt`, `current_estimate.txt` | Live Segment, when it's Core Content |
| `performer1_name.txt` … `performer4_name.txt` | Performer names, when the Live Segment is Core Content |
| `performerN_pronouns.txt` | Pronouns |
| `performerN_social.txt` | Social with its site, e.g. `twitch.tv/BlazeBops`, `youtube.com/@name` |
| `performerN_handle.txt` | Just the handle (`BlazeBops`, `@name`), for layouts with a platform icon |
| `host_name.txt`, `host_category.txt`, `host_estimate.txt`, `hostN_name.txt`, `hostN_pronouns.txt`, `hostN_social.txt`, `hostN_handle.txt` | The same files for a Host/Interstitial Live Segment |
| `next_name.txt`, `next_category.txt`, `next_estimate.txt`, `next_performers.txt` | Next Segment (performer names joined with commas) |
| `future1_*.txt` … `future4_*.txt` | Future runs, with the same four files each, for the break scene |

The Live Segment only writes its own type's files. While a Host/Interstitial segment is live, the `current_*` and `performerN_*` files keep their last Core Content values, and the other way round.

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
