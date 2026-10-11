// Register the bot's slash commands with Discord.
//
// The live server is served from the GLOBAL command set. Guild-scoped registration is for the test
// guild, where it propagates instantly instead of taking up to an hour.
//
// The target is always explicit -- running this with no arguments prints the current state and does
// nothing, so a "deploy" can never look like it succeeded while leaving real users' commands untouched.
//
//   npm run deploy -- --list               show what's registered vs. what's here
//   npm run deploy -- --global             deploy globally (this is the real one)
//   npm run deploy -- --guild [id]         deploy to one guild for testing (defaults to TEST_GUILD_ID)
//   npm run deploy -- --clear-guild [id]   remove a guild's own registrations
//
// Requires clientId and token in .env. Safe to re-run: every mode is a PUT, which replaces the whole
// command set rather than appending to it.

require('dotenv').config({ path: __dirname + '/../../.env' })

const { REST, Routes } = require('discord.js');
const { main_guild, test_guild } = require('../data/discord/guild.js');
const fs = require('node:fs');
const path = require('node:path');

// Commands that exist in the repo but are deliberately kept out of the GLOBAL set.
// --guild deploys still include them, which is how you test them.
const EXCLUDE = [];

const COMMAND_DIR = path.join(__dirname, '../commands');

function loadCommands({ applyExcludes }) {
	const commands = [];
	const skipped = [];
	const broken = [];
	for (const file of fs.readdirSync(COMMAND_DIR).filter(f => f.endsWith('.js'))) {
		const command = require(path.join(COMMAND_DIR, file));
		if (!command.data) continue;
		if (applyExcludes && EXCLUDE.includes(command.data.name)) { skipped.push(command.data.name); continue; }
		// A definition that won't serialise is one command's problem, not the deploy's.
		try {
			commands.push(command.data.toJSON());
		} catch (err) {
			broken.push({ file, name: command.data.name, why: err.message });
		}
	}
	return { commands, skipped, broken };
}

const clientID = process.env.clientId;
const token = process.env.token;

if (!clientID || !token) {
	console.error('Missing clientId or token in .env - nothing to do.');
	process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);
const names = list => list.map(c => '/' + c.name).sort().join(' ') || '(none)';

async function show(label, route) {
	try {
		const current = await rest.get(route);
		console.log(`  ${label}: ${current.length}\n    ${names(current)}`);
		return current;
	} catch (err) {
		console.log(`  ${label}: unreadable (${err.status || ''} ${err.message})`);
		return null;
	}
}

(async () => {
	const [mode, arg] = process.argv.slice(2);
	const { commands, skipped, broken } = loadCommands({ applyExcludes: mode !== '--guild' });

	console.log(`Found ${commands.length} command(s) in ${COMMAND_DIR}`);
	console.log(`  ${names(commands)}`);
	if (skipped.length) console.log(`  excluded from global: ${skipped.join(' ')}`);
	for (const b of broken) {
		console.log(`  BROKEN, not deployed: ${b.file} (${b.name || 'unnamed'}) — ${b.why}`);
	}
	console.log('');

	try {
		if (mode === '--global') {
			const before = await rest.get(Routes.applicationCommands(clientID));
			const added = commands.filter(c => !before.some(b => b.name === c.name)).map(c => c.name);
			const removed = before.filter(b => !commands.some(c => c.name === b.name)).map(b => b.name);

			const data = await rest.put(Routes.applicationCommands(clientID), { body: commands });
			console.log(`Deployed ${data.length} command(s) globally.`);
			if (added.length) console.log(`  added:   ${added.map(n => '/' + n).join(' ')}`);
			if (removed.length) console.log(`  removed: ${removed.map(n => '/' + n).join(' ')}`);
			if (!added.length && !removed.length) console.log('  no change to the command list (definitions may still have updated)');
			console.log('\nGlobal commands can take up to an hour to appear everywhere.');
			return;
		}

		if (mode === '--guild') {
			const guildId = arg || test_guild;
			if (!guildId) return console.error('--guild needs a guild id (or TEST_GUILD_ID in .env).');
			const data = await rest.put(Routes.applicationGuildCommands(clientID, guildId), { body: commands });
			console.log(`Deployed ${data.length} command(s) to guild ${guildId} (instant).`);
			console.log('Note: a guild copy sits alongside the global set - expect duplicates for any shared name.');
			return;
		}

		if (mode === '--clear-guild') {
			const guildId = arg || test_guild;
			if (!guildId) return console.error('--clear-guild needs a guild id (or TEST_GUILD_ID in .env).');
			await rest.put(Routes.applicationGuildCommands(clientID, guildId), { body: [] });
			console.log(`Cleared all guild-scoped commands for ${guildId}. That guild now uses the global set.`);
			return;
		}

		// --list, and the no-argument default.
		console.log('Currently registered:');
		await show('global', Routes.applicationCommands(clientID));
		for (const [label, id] of [['main guild', main_guild], ['test guild', test_guild]]) {
			if (id) await show(`${label} (${id})`, Routes.applicationGuildCommands(clientID, id));
		}
		if (mode !== '--list') {
			console.log('\nNothing deployed. Pass --global to deploy for real, or --list to just look.');
		}
	} catch (error) {
		console.error('Deploy failed:', error.status || '', error.message);
		process.exitCode = 1;
	}
})();
