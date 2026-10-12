const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const records = require('../records.js')
const data = require('../swgr/data.js')

// Removing a saved time (a typo, a wrong event, a run that shouldn't count). Anyone can remove their own; server
// managers and /submitter people can remove anyone's. The entry is picked from an autocomplete of the times you
// may remove, searchable by event, scenario, time or racer.
const reply = (interaction, content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
const nameOf = t => (t.kind == 'arcade' ? data.event(t.target) : data.scenario(t.target))?.name ?? t.target
const formatTime = s => {
    const cs = Math.round(s * 100), m = Math.floor(cs / 6000), rest = (cs % 6000) / 100
    return m ? `${m}:${rest.toFixed(2).padStart(5, '0')}` : rest.toFixed(2)
}
// What a member may remove: their own times, or everyone's if they can submit for others
const removable = interaction => {
    const all = records.allTimes()
    return records.canSubmitForOthers(interaction.member) ? all : all.filter(t => t.user == interaction.user.id)
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('times')
        .setDescription('manage saved times')
        .addSubcommand(sub => sub.setName('remove').setDescription('remove a saved time')
            .addStringOption(o => o.setName('entry').setDescription('the time to remove (search by event, time or racer)').setRequired(true).setAutocomplete(true))),
    async execute({ interaction } = {}) {
        const id = interaction.options.getString('entry')
        const t = removable(interaction).find(x => x.id == id)
        if (!t) return reply(interaction, "That isn't one of the times you can remove. Pick one from the list as you type.")
        await records.removeTime(id)
        return reply(interaction, `Removed ${formatTime(t.time)} by <@${t.user}> on ${nameOf(t)}.`)
    },
    async autocomplete(interaction) {
        const q = interaction.options.getFocused().toLowerCase()
        const names = {}
        const label = t => {
            const who = t.user == interaction.user.id ? 'you' : (names[t.user] ??= interaction.guild?.members.cache.get(t.user)?.displayName ?? `user ${t.user.slice(-4)}`)
            const day = new Date(t.date).toISOString().slice(0, 10)
            return `${formatTime(t.time)} on ${nameOf(t)} by ${who} (${day})`.slice(0, 100)
        }
        await interaction.respond(removable(interaction).map(t => ({ name: label(t), value: t.id }))
            .filter(o => o.name.toLowerCase().includes(q)).slice(0, 25))
    },
}
