require('dotenv').config({ path: __dirname + '/../.env' })

const { testing } = require('../config.js')

const { test_guilds } = require('./data/discord/guild.js')
const { log_channel } = require('./data/discord/channel.js')
const viewer = require('./viewer.js')
const { errorMessage } = require('./data/flavor/error.js')

const fs = require('fs');
const { Client, Events, GatewayIntentBits, Collection, MessageFlags, Partials } = require('discord.js')
const client = new Client({
    // GuildMembers (privileged: Server Members Intent in the Developer Portal) is for join messages; GuildMessages and
    // MessageContent (privileged: Message Content Intent) for runs posted in the replay channel (src/replays.js)
    // GuildMessageReactions (with the partials, so reactions on messages from before a restart arrive too): a ⏱️
    // reaction asks for a message to be read as a run
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions],
    partials: [Partials.Message, Partials.Reaction, Partials.User, Partials.GuildMember],  // GuildMember: role changes (backers) for uncached members
});

//add commands to client
const commandFiles = fs.readdirSync(__dirname + '/commands/').filter(file => file.endsWith('.js'));
client.commands = new Collection();
for (const file of commandFiles) {
    const command = require(__dirname + `/commands/${file}`);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${file} is missing a required "data" or "execute" property.`);
    }
}

//add buttons to client
//
// Components (buttons, selects, modals) are routed by customId: everything before the first "_" picks
// the handler in src/interactions/ by its `name`, and the rest is passed along as `args`.
const buttonFiles = fs.readdirSync(__dirname + '/interactions').filter(file => file.endsWith('.js'));
client.buttons = new Collection();
for (const file of buttonFiles) {
    const button = require(__dirname + `/interactions/${file}`);
    client.buttons.set(button.name, button);
}

// While testing, only the test guilds (TEST_GUILD_ID plus TESTING_GUILDS) are served; live, everything except
// them is. This lets a local copy and the deployed bot share one application without both answering the same
// interaction.
function switchGuard(guildId) {
    return testing ? test_guilds.includes(guildId) : !test_guilds.includes(guildId)
}

//interactions
client.on(Events.InteractionCreate, async interaction => {
    if (!switchGuard(interaction.guildId)) return;

    //autocomplete
    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        try {
            await command?.autocomplete?.(interaction);
        } catch (error) {
            console.error(error);
        }
        return
    }

    //log command
    console.log(interaction.isChatInputCommand() ? 'slash' :
        interaction.isButton() ? 'button' :
            interaction.isMessageComponent() ? 'message_component' :
                interaction.isModalSubmit() ? 'modal_submit' :
                    'other', interaction.isChatInputCommand() ? interaction.commandName : interaction.customId, interaction.member?.displayName ?? interaction.user.displayName)

    const context = {
        client,
        interaction,
        member_id: interaction.member?.id ?? interaction.user.id,
        member_name: interaction.member?.displayName ?? interaction.user.displayName,
        member_avatar: interaction.member?.displayAvatarURL() ?? interaction.user.displayAvatarURL(),
    }

    //command handler
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName.toLowerCase());
        if (!command) {
            console.log('command does not exist')
            return;
        }
        try {
            await viewer.run(context.member_id, () => command.execute(context));
        } catch (error) {
            reportError(`Command: ${interaction.commandName}`, error);
            try {
                const msg = { content: "`Error: Command failed to execute `\n" + errorMessage[Math.floor(Math.random() * errorMessage.length)], flags: MessageFlags.Ephemeral };
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(msg);
                } else {
                    await interaction.reply(msg);
                }
            } catch (_) { }
        }
    } else if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
        const [name, ...args] = interaction.customId.split("_")
        const button = client.buttons.get(name)
        if (!button) {
            console.log(`no interaction handler named "${name}"`)
            return
        }
        try {
            await viewer.run(context.member_id, () => button.execute({ ...context, args }));
        } catch (error) {
            reportError(`Button: ${name}`, error);
        }
    }
})

client.once(Events.ClientReady, () => {
    console.log(`Ready! Logged in as ${client.user.tag}${testing ? ' (testing)' : ''}`)
    require('./feeds/index.js').start(client, reportError).catch(error => reportError('Feeds', error))
    require('./records.js').listen()
    // Credits (src/credits.js), and an hourly sweep that returns expired bounties to their funders
    const credits = require('./credits.js')
    credits.listen()
    const { main_guild, test_guild } = require('./data/discord/guild.js')
    setInterval(() => credits.expireBounties(client.guilds.cache.get(testing ? test_guild : main_guild))
        .catch(error => reportError('Bounties', error)), 60 * 60 * 1000)
    // Racers' names and avatars for the website (src/profiles.js): once the times and balances have loaded, then hourly
    if (!testing) {
        const profiles = () => require('./profiles.js').refresh(client, client.guilds.cache.get(main_guild))
            .then(n => n && console.log(`[profiles] updated ${n}`)).catch(error => reportError('Profiles', error))
        setTimeout(profiles, 30 * 1000)
        setInterval(profiles, 60 * 60 * 1000)
        // Proof links to Discord files expire after a day; renew them (src/proofs.js)
        const proofs = require('./proofs.js')
        const renew = () => proofs.refresh(client).then(r => r.renewed && console.log(`[proofs] renewed ${r.renewed} of ${r.due} file links`))
            .catch(error => reportError('Proof links', error))
        setTimeout(renew, 40 * 1000)
        setInterval(renew, proofs.REFRESH_EVERY)
    }
})

// Switching backer (onboarding roles) restarts the day before the new backer counts for credits (src/credits.js)
client.on(Events.GuildMemberUpdate, (before, after) => {
    if (!switchGuard(after.guild.id)) return
    const credits = require('./credits.js')
    const now = credits.backerFromRoles(after), record = credits.backerRecord(after.id)
    if ((record?.backer ?? null) != now) credits.setBacker(after.id, now).catch(error => reportError('Backer', error))
})

// Runs posted as videos in the replay channel (src/replays.js)
client.on(Events.MessageCreate, message => {
    if (!message.guildId || !switchGuard(message.guildId)) return
    // "@Autopilot ..." anywhere submits a run (src/replays.js handleMention): the bot's own mention or its role's
    const replays = require('./replays.js')
    if (!message.author.bot && replays.mentionsMe(message)) {
        return replays.handleMention(message).catch(error => reportError('Mention', error))
    }
    replays.handle(message).catch(error => reportError('Replays', error))
})

// A ⏱️ reaction on any message reads it like a replay-channel post (src/replays.js), from people who can submit for
// others or from the message's own author; the bot's own stopwatch reaction confirms a saved run
client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
        if (user.bot || !reaction.emoji.name?.startsWith('⏱')) return
        if (reaction.partial) await reaction.fetch()
        const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message
        if (!message.guildId || !switchGuard(message.guildId)) return
        const member = await message.guild.members.fetch(user.id).catch(() => null)
        if (user.id != message.author.id && !require('./records.js').canSubmitForOthers(member)) return
        console.log(`reaction ⏱️ on ${message.url} by ${user.username}`)
        await require('./replays.js').handle(message, { anywhere: true })
    } catch (error) { reportError('Stopwatch reaction', error) }
})

// Join messages (src/welcome.js)
client.on(Events.GuildMemberAdd, member => {
    if (!switchGuard(member.guild.id)) return
    require('./welcome.js').welcome(member).catch(error => reportError('Welcome', error))
})

// Global error handling — prevent crashes and report to the log channel when live
async function reportError(label, error) {
    console.error(`[${label}]`, error);
    if (!testing && log_channel) {
        try {
            const channel = client.channels?.cache?.get(log_channel);
            if (channel) {
                const stack = error?.stack || String(error);
                await channel.send(`**${label}**\n\`\`\`\n${stack.slice(0, 1900)}\n\`\`\``);
            }
        } catch (e) {
            console.error('Failed to report error to Discord:', e);
        }
    }
}

process.on('uncaughtException', (error) => {
    reportError('Uncaught Exception', error);
});

process.on('unhandledRejection', (error) => {
    reportError('Unhandled Rejection', error);
});

client.on('error', (error) => {
    reportError('Client Error', error);
});

client.login(process.env.token);
