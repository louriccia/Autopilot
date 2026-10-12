const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const records = require('../records.js')
const data = require('../swgr/data.js')

// /times staff and staff-remove manage the staff times (database staff/, see src/records.js).
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
            .addStringOption(o => o.setName('entry').setDescription('the time to remove (search by event, time or racer)').setRequired(true).setAutocomplete(true)))
        // Staff times: the developer's and publisher's own runs, shown with their logo on arcade cards (by name)
        .addSubcommand(sub => sub.setName('staff').setDescription('set a staff time on an arcade event (server managers)')
            .addStringOption(o => o.setName('event').setDescription('the arcade event').setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName('time').setDescription('e.g. 1:08.92').setRequired(true))
            .addStringOption(o => o.setName('from').setDescription('whose staff').setRequired(true)
                .addChoices({ name: 'Developer (Fuse Games)', value: 'developer' }, { name: 'Publisher', value: 'publisher' }))
            .addUserOption(o => o.setName('racer').setDescription('the staff member, shown as a mention'))
            .addStringOption(o => o.setName('name').setDescription("their name, if they have no Discord account here (default: the racer's)").setMaxLength(32)))
        .addSubcommand(sub => sub.setName('staff-remove').setDescription('remove a staff time (server managers)')
            .addStringOption(o => o.setName('event').setDescription('the arcade event').setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName('name').setDescription('the staff member').setRequired(true))),
    async execute({ interaction } = {}) {
        const sub = interaction.options.getSubcommand()
        if (sub.startsWith('staff')) {
            if (!records.canSubmitForOthers(interaction.member)) return reply(interaction, 'Only server managers and submitters can change staff times.')
            const event = data.event(interaction.options.getString('event'))
            if (!event) return reply(interaction, 'Pick an arcade event from the list.')
            const racer = interaction.options.getUser('racer')
            const name = interaction.options.getString('name')?.trim() || racer?.username
            if (!name) return reply(interaction, 'Pick the staff member as the racer, or give their name.')
            if (sub == 'staff-remove') {
                return reply(interaction, await records.removeStaffTime(event.id, name)
                    ? `Removed ${name}'s staff time on ${event.name}.` : `${name} has no staff time on ${event.name}.`)
            }
            const seconds = records.parseTime(interaction.options.getString('time'))
            if (seconds == null) return reply(interaction, "That isn't a time. Use minutes:seconds, like 1:08.92.")
            await records.setStaffTime(event.id, name, seconds, interaction.options.getString('from'), racer?.id)
            return reply(interaction, `${name}: ${formatTime(seconds)} on ${event.name}, shown as a ${interaction.options.getString('from')} staff time.`)
        }
        const id = interaction.options.getString('entry')
        const t = removable(interaction).find(x => x.id == id)
        if (!t) return reply(interaction, "That isn't one of the times you can remove. Pick one from the list as you type.")
        await records.removeTime(id)
        return reply(interaction, `Removed ${formatTime(t.time)} by <@${t.user}> on ${nameOf(t)}.`)
    },
    async autocomplete(interaction) {
        const q = interaction.options.getFocused().toLowerCase()
        if (interaction.options.getFocused(true).name == 'event') {
            return interaction.respond(data.events.filter(e => e.name.toLowerCase().includes(q)).slice(0, 25).map(e => ({ name: e.name, value: e.id })))
        }
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
