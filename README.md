# Autopilot

A Discord bot for the Star Wars: Galactic Racer server. Its command and interaction handlers follow the pattern used by [Botto](https://github.com/louriccia/Botto).

## Commands

* **/search &lt;query&gt;** - find anything (arcade events and categories, tracks, planets, scenarios, racer styles, parts, part keywords, abilities, vehicles, vehicle classes, favors, rivals, mysteries, status effects, backers, Tales of Podracing) and open its page
* **/arcade [event] [category]** - arcade events: medal times and rivals, track, vehicle, build, parts and unlocks
* **/track &lt;name&gt;** - track map, format, laps and the arcade events run on it
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
* **/help** - list of Autopilot's commands
* **/ping** - check that Autopilot is online and its response time

The reference pages link to each other through select menus and buttons. Whoever ran the command navigates in place; anyone else who clicks gets a private copy.

## Game data

`src/data/swgr/*.json` and `assets/` are generated from the `swgr-datamine` outputs (expected next to this repo) by:

```
python tools/import_swgr.py
```

Re-run it when the datamine is refreshed (needs Pillow and the texture export on `E:\SWGR_Export`), then upload any new stat/part/ability icons as application emojis:

```
node src/scripts/upload-emojis.js
```

## Setup

1. Create an application at https://discord.com/developers/applications and add a bot.
2. Copy `.env.example` to `.env` and fill in `token`, `clientId`, and the guild/channel IDs.
3. Install and register commands with the test guild:

   ```
   npm install
   npm run deploy -- --guild
   ```

4. Start the bot: `npm start`

When it's ready to go live, deploy globally with `npm run deploy -- --global` and run with `TESTING=false`.

## Adding things

* **Slash command** - copy `src/templates/command.js` into `src/commands/`, then redeploy commands.
* **Button / select / modal** - copy `src/templates/interaction.js` into `src/interactions/`. A component's `customId` is split on `_`; the first piece picks the handler by `name` and the rest arrive as `args`.
