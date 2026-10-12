require('dotenv').config({ path: __dirname + '/../.env' })

const { testing } = require('../config.js')

const { test_guilds } = require('./data/discord/guild.js')
const { log_channel } = require('./data/discord/channel.js')
const { errorMessage } = require('./data/flavor/error.js')

const fs = require('fs');
const { Client, Events, GatewayIntentBits, Collection, MessageFlags } = require('discord.js')
const client = new Client({
    // GuildMembers (privileged: Server Members Intent in the Developer Portal) is for join messages
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
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
            await command.execute(context);
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
            await button.execute({ ...context, args });
        } catch (error) {
            reportError(`Button: ${name}`, error);
        }
    }
})

client.once(Events.ClientReady, () => {
    console.log(`Ready! Logged in as ${client.user.tag}${testing ? ' (testing)' : ''}`)
    require('./feeds/index.js').start(client, reportError).catch(error => reportError('Feeds', error))
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
