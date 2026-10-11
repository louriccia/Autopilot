# Autopilot

A Discord bot for the Star Wars: Galactic Racer server. Its command and interaction handlers follow the pattern used by [Botto](https://github.com/louriccia/Botto).

## Commands

* **/help** - list of Autopilot's commands
* **/ping** - check that Autopilot is online and its response time

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
