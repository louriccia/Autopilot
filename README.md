# Autopilot

A Discord bot for the Star Wars: Galactic Racer community server: a searchable reference for the game, community leaderboards for arcade events and scenarios, and announcements for patches, videos and streams. Its command and interaction handlers follow the pattern used by [Botto](https://github.com/louriccia/Botto).

> **Fan project.** Autopilot is not affiliated with or endorsed by Lucasfilm, Disney, Fuse Games or Secret Mode. STAR WARS: Galactic Racer and everything in it belong to their owners. The game's art, text and dialogue are **not** included in this repository (see [Game data](#game-data)).

## Commands

* **/search &lt;query&gt;** - find anything (arcade events and categories, tracks, planets, scenarios, racer styles, parts, part keywords, abilities, vehicles, vehicle classes, favors, rivals, mysteries, status effects, backers, Tales of Podracing, livery palettes and patterns) and open its page
* **/arcade [event] [category]** - arcade events: medal times and rivals, track, vehicle, build, parts and unlocks
* **/track &lt;name&gt;** - track map, format, laps, variants, and the scenarios, arcade events and acts it's raced in
* **/planet &lt;name&gt;** - planet description, conditions and tracks
* **/scenario &lt;name&gt;** - a scenario's racer style, starting build, day-by-day schedule and track pools
* **/style &lt;name&gt;** - a racer style's starting abilities, traits per level and how each level unlocks
* **/part [name]** - a part's effect, rarity, cost, tiers, unlock and the arcade events / scenarios that use it; with no name, find parts by keyword
* **/ability [name]** - an ability's effect, reload, energy, cost, upgrade tree, preflight check and where it's used; with no name, browse the families
* **/vehicle [name]** - a vehicle's manufacturer, Kit Points cost, unlock, parts, rivals who race it and arcade events; with no name, browse the classes and their traits
* **/favor [name]** - a favor's effect at each rank, who offers it and how each rank unlocks; with no name, list them all
* **/rival [name]** - a rival's bio, vehicles, Head-to-Head races and the favor and livery for beating them; with no name, list them all
* **/mystery [name]** - a Mystery Encounter's offer, when it can appear, every choice and its outcomes with their odds and follow-ups; with no name, list them all
* **/status [name]** - a status effect's definition, whether it stacks, and the abilities, racer style traits, favors and parts that use it; with no name, list them all
* **/backer [name]** - a backer (sponsor): who they are, starting credits, their six contracts with pay and targets, their penalty and favor; with no name, list them all
* **/tale [name]** - a Tales of Podracing event: track, Sebulba's loadout, win conditions, opponents and rewards; with no name, list all 12 in order
* **/livery [name]** - a livery palette (colours, cost, unlock) or pattern (top-down render per vehicle class); with no name, browse palettes, patterns and finishes
* **/help** - list of Autopilot's commands
* **/ping** - check that Autopilot is online and its response time

The reference pages link to each other through select menus and buttons, and anyone can move a card along in place. A plain announcement's **View board** button posts the board as a reply.


## Times and feedback

Arcade event and scenario cards have a **Submit** button (time, platform, optional proof link and notes) and three thumbs buttons for feedback, which anyone can use without submitting a time. Each person's best time joins the card's leaderboard. Times are linked to Discord accounts, never names. Server managers, anyone added with **/submitter add**, and anyone with a role in `SUBMITTER_ROLE_IDS` can submit for someone else. Times can be typed as `1:08.92` or as digits only (`10892`). **/submit &lt;board&gt; &lt;time&gt; [racer] [platform] [proof] [notes]** is the quick way: pick the arcade event or scenario as you type. An exact repeat (same person, board and time) is never saved twice; new details on it (platform, proof, notes) replace the old ones. You can also mention the bot anywhere: **@Autopilot Ramjet Run 1:13.59** saves that time for you (any attachment or link is its proof), and **@Autopilot** with a screenshot or YouTube link reads the run from it. Mention someone else as well to submit for them (if you can submit for others); that's also how a forwarded run gets its racer, since Discord doesn't tell bots who wrote a forwarded message. Saving runs earns **credits**: personal bests, first medals, bops, podiums and world records on busy boards, more with video proof. Your onboarding backer (the Hutt, the Broker or the Pirate) shifts what pays best. **/credits** shows balances and the leaderboard; **/bounty post** puts credits on the first run under a time on a board. **/times remove** takes a time back: your own, or anyone's if you can submit for others. **/times export** downloads the times as a CSV (once every 10 minutes); edit it in a spreadsheet and **/times import** it back: change a row to correct that time, clear its time to remove it, or add rows without an entry_id for new times. The headers have to stay exactly as exported.

## Announcements

The bot also posts on its own:

* **Patches** (`PATCH_CHANNEL_ID`) - a new Steam build goes live (build id, time, download size; checked every 5 minutes), and official Steam announcements, with patch notes in full (every 10 minutes)
* **Videos** (`VIDEO_CHANNEL_ID`) - new uploads on the official YouTube channel (`YOUTUBE_CHANNELS` to change or add channels; every 10 minutes)
* **Streams** (`STREAM_CHANNEL_ID`) - someone is live on Twitch in the game's category with at least `TWITCH_MIN_VIEWERS` watching (default 100) in English (`TWITCH_LANGUAGES` to change), at most once per streamer every 8 hours (every 3 minutes; needs `TWITCH_ID` / `TWITCH_SECRET`). Recognized streamers skip the minimum and get a bigger card: server managers add them with **/streamer add &lt;twitch&gt;** (also `remove` and `list`)

While testing, everything goes to `TEST_CHANNEL_ID`. `node src/scripts/preview-feeds.js` posts the latest of each there to check the cards.
## Game data

The game content the bot shows (`src/data/swgr/*.json`, the art in `assets/`, and the dialogue in `src/data/flavor/welcome.js`) is git-ignored and never published. It's generated from a local datamine of the game (`swgr-datamine`, expected next to this repo) by:

```
python tools/import_swgr.py
```

Re-run it when the datamine is refreshed (needs Pillow and the texture export on `E:\SWGR_Export`), then upload any new stat/part/ability icons as application emojis:

```
node src/scripts/upload-emojis.js
```

## Setup

1. Create an application at https://discord.com/developers/applications and add a bot.
2. Copy `.env.example` to `.env` and fill in `token`, `clientId`, the guild/channel IDs and the Firebase service account (the bot runs without a database if those are blank).
3. Install and register commands with the test guild:

   ```
   npm install
   npm run deploy -- --guild
   ```

4. Start the bot: `npm start`

When it's ready to go live, deploy globally with `npm run deploy -- --global` and run with `TESTING=false`.

## Deploying

The live bot runs on Heroku as a `worker` dyno. Since the game content isn't in git, deploy with:

```
npm run ship
```

which force-pushes the current commit plus the game content (as a one-off commit built in a separate index; your branch and working tree are untouched) to the `heroku` remote.

## Adding things

* **Slash command** - copy `src/templates/command.js` into `src/commands/`, then redeploy commands.
* **Button / select / modal** - copy `src/templates/interaction.js` into `src/interactions/`. A component's `customId` is split on `_`; the first piece picks the handler by `name` and the rest arrive as `args`.

## License

The code is MIT licensed (see [LICENSE](LICENSE)). That covers this repository's code only, not the game or its content.
