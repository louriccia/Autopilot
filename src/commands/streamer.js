const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { database } = require('../firebase.js')
const { helix } = require('../feeds/twitch.js')

// Recognized streamers: their streams are always announced (no viewer minimum) on the big card. Kept in the database
// at streamers/<twitch user id> = { login, name, addedBy, addedAt }. Server managers only.
const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral })

module.exports = {
    data: new SlashCommandBuilder()
        .setName('streamer')
        .setDescription('manage recognized streamers: always announced, on the big card')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand(sub => sub.setName('add').setDescription('recognize a Twitch streamer')
            .addStringOption(o => o.setName('twitch').setDescription('their Twitch username or channel link').setRequired(true)))
        .addSubcommand(sub => sub.setName('remove').setDescription('stop recognizing a Twitch streamer')
            .addStringOption(o => o.setName('twitch').setDescription('their Twitch username').setRequired(true).setAutocomplete(true)))
        .addSubcommand(sub => sub.setName('list').setDescription('list the recognized streamers')),
    async execute({ interaction, member_id } = {}) {
        if (!database) return reply(interaction, 'The database is not set up, so streamers cannot be saved.')
        const sub = interaction.options.getSubcommand()
        const ref = database.ref('streamers')

        if (sub == 'list') {
            const list = Object.values((await ref.get()).val() ?? {}).sort((a, b) => a.name.localeCompare(b.name))
            return reply(interaction, list.length
                ? `**Recognized streamers** (${list.length})\n${list.map(s => `[${s.name}](<https://www.twitch.tv/${s.login}>)`).join('\n')}`
                : 'No recognized streamers yet. Add one with `/streamer add`.')
        }

        // "SomeName", "@SomeName" or "https://www.twitch.tv/somename"
        const login = interaction.options.getString('twitch').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').split(/[/?#]/)[0].toLowerCase()
        if (sub == 'remove') {
            const all = (await ref.get()).val() ?? {}
            const id = Object.keys(all).find(k => all[k].login == login)
            if (!id) return reply(interaction, `**${login}** isn't a recognized streamer.`)
            await ref.child(id).remove()
            return reply(interaction, `**${all[id].name}** is no longer recognized.`)
        }

        if (!/^\w{3,25}$/.test(login)) return reply(interaction, `"${login}" doesn't look like a Twitch username.`)
        const [user] = await helix(`users?login=${login}`)
        if (!user) return reply(interaction, `There's no Twitch user called **${login}**.`)
        await ref.child(user.id).set({ login: user.login, name: user.display_name, addedBy: member_id, addedAt: Date.now() })
        return reply(interaction, `**${user.display_name}** is now a recognized streamer: their streams of the game are always announced, on the big card.`)
    },
    async autocomplete(interaction) {
        const q = interaction.options.getFocused().toLowerCase()
        const all = Object.values((await database?.ref('streamers').get())?.val() ?? {})
        await interaction.respond(all.filter(s => s.login.includes(q) || s.name.toLowerCase().includes(q)).slice(0, 25).map(s => ({ name: s.name, value: s.login })))
    },
}
