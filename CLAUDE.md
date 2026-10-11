# Autopilot - Discord Bot

Discord.js v14 bot for the Star Wars: Galactic Racer server. Its command/interaction handler skeleton is borrowed from Botto (`../Botto`); nothing else from Botto is carried over.

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: discord.js v14
- **Deployment**: Procfile `worker` process (no HTTP surface, unlike Botto's `web` dyno)

## Project Structure

```
config.js             # testing flag + clientId
src/
  bot.js              # Entry point: loads handlers, dispatches interactions, error reporting
  commands/           # One slash command per file: { data: SlashCommandBuilder, execute, autocomplete? }
  interactions/       # Component/modal handlers: { name, execute }, routed by customId prefix
  data/discord/       # Guild and channel IDs (from .env)
  data/flavor/        # Flavor text
  scripts/deploy-commands.js  # Register slash commands (--list | --global | --guild | --clear-guild)
  templates/          # Starting points for new commands and interactions (not loaded)
```

## Key Concepts

- **Handler context**: every `execute` receives `{ client, interaction, member_id, member_name, member_avatar }`; interaction handlers also get `args`.
- **customId routing**: `"<name>_<arg1>_<arg2>"` → `src/interactions/<handler with that name>` with `args = [arg1, arg2]`. Handler names must not contain `_`.
- **Guild switching**: `testing` (from `TESTING` in .env, or automatically when `USERNAME == 'louri'`) makes the bot answer only in `TEST_GUILD_ID`; live, it answers everywhere except there.
- **Errors**: `reportError()` in bot.js posts stack traces to `LOG_CHANNEL_ID` when live.
- **Intents**: only `Guilds`. Add more (and enable privileged ones in the Developer Portal) when a feature needs them.
- After adding or changing a command's `data`, re-run `npm run deploy -- --guild` (test) or `--global` (live).
