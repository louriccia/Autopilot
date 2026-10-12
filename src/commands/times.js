const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const records = require('../records.js')
const data = require('../swgr/data.js')
const emoji = require('../data/discord/emoji.js')

// /times staff and staff-remove manage the staff times (database staff/, see src/records.js); /times youtube sets
// whose runs a YouTube channel's videos are (database youtube/, src/replays.js).
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

// /times export and import: spreadsheets of times (src/sheets.js). Export is once per EXPORT_EVERY per person; import
// once per IMPORT_EVERY. Anyone can import their own times; people who can submit for others can import anyone's.
const EXPORT_EVERY = 10 * 60 * 1000, IMPORT_EVERY = 60 * 1000, MAX_FILE = 2 * 1024 * 1024
const lastUse = new Map()  // "<sub>:<user id>" -> time
async function sheet(interaction, sub) {
    const sheets = require('../sheets.js')
    const key = `${sub}:${interaction.user.id}`, wait = (sub == 'export' ? EXPORT_EVERY : IMPORT_EVERY) - (Date.now() - (lastUse.get(key) ?? 0))
    if (wait > 0) return reply(interaction, `You can ${sub} again <t:${Math.ceil((Date.now() + wait) / 1000)}:R>.`)
    await interaction.deferReply({ flags: MessageFlags.Ephemeral })
    lastUse.set(key, Date.now())
    const members = interaction.guild ? await interaction.guild.members.fetch().catch(() => interaction.guild.members.cache) : new Map()
    const day = new Date().toISOString().slice(0, 10)

    if (sub == 'export') {
        const [kind, target] = (interaction.options.getString('board') ?? '').split(':')
        const racer = interaction.options.getUser('racer')
        const times = records.allTimes().filter(t => (!target || (t.kind == kind && t.target == target)) && (!racer || t.user == racer.id))
            .sort((a, b) => a.kind.localeCompare(b.kind) || nameOf(a).localeCompare(nameOf(b)) || a.time - b.time)
        if (!times.length) { lastUse.delete(key); return interaction.editReply('No saved times match that.') }
        const names = {}
        for (const id of new Set(times.map(t => t.user))) names[id] = members.get(id)?.user.username ?? (await interaction.client.users.fetch(id).catch(() => null))?.username ?? ''
        return interaction.editReply({
            content: `${times.length} time${times.length == 1 ? '' : 's'}. Edit it and bring it back with **/times import**: keep the headers as they are; a row's racer is its discord_id, or its username if the id is blank.`,
            files: [{ attachment: Buffer.from(sheets.toCsv(times, names)), name: `autopilot-times-${day}.csv` }],
        })
    }

    const file = interaction.options.getAttachment('file')
    if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/.test(file.contentType ?? '')) { lastUse.delete(key); return interaction.editReply('Attach a .csv file.') }
    if (file.size > MAX_FILE) { lastUse.delete(key); return interaction.editReply('That file is over 2 MB.') }
    const csv = await (await fetch(file.url)).text()
    const r = await sheets.importCsv(csv, { importer: interaction.member, members })
    if (r.error) { lastUse.delete(key); return interaction.editReply(r.error) }
    const lines = [
        `Imported **${file.name}**: ${r.saved} new, ${r.updated} corrected, ${r.deleted} removed, ${r.unchanged} unchanged${r.failed.length ? `, **${r.failed.length} failed**` : ''}.`,
        ...r.failed.slice(0, 15).map(f => `-# Row ${f.row}: ${f.reason}`),
        r.failed.length > 15 && `-# …and ${r.failed.length - 15} more.`,
        r.failed.length && 'The failed rows are attached with the same headers: fix them and import that file.',
    ].filter(Boolean)
    return interaction.editReply({
        content: lines.join('\n').slice(0, 2000), allowedMentions: { parse: [] },
        files: r.failed.length ? [{ attachment: Buffer.from(sheets.failedCsv(r.failed)), name: `failed-rows-${day}.csv` }] : [],
    })
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
            .addStringOption(o => o.setName('time').setDescription('e.g. 1:08.92, or just the digits: 10892').setRequired(true))
            .addStringOption(o => o.setName('from').setDescription('whose staff').setRequired(true)
                .addChoices({ name: 'Developer (Fuse Games)', value: 'developer' }, { name: 'Publisher', value: 'publisher' }))
            .addUserOption(o => o.setName('racer').setDescription('the staff member, shown as a mention'))
            .addStringOption(o => o.setName('name').setDescription("their name, if they have no Discord account here (default: the racer's)").setMaxLength(32)))
        .addSubcommand(sub => sub.setName('staff-remove').setDescription('remove a staff time (server managers)')
            .addStringOption(o => o.setName('event').setDescription('the arcade event').setRequired(true).setAutocomplete(true))
            .addStringOption(o => o.setName('name').setDescription('the staff member').setRequired(true)))
        // Whose runs a YouTube channel's videos are (src/replays.js links a channel to its first poster)
        .addSubcommand(sub => sub.setName('youtube').setDescription("set whose runs a YouTube channel's videos are (server managers)")
            .addStringOption(o => o.setName('video').setDescription('a link to any video from the channel').setRequired(true))
            .addUserOption(o => o.setName('racer').setDescription('whose channel it is').setRequired(true)))
        // A declared rival, compared on timesheets and receipts
        .addSubcommand(sub => sub.setName('rival').setDescription('declare your rival (leave racer empty to clear it)')
            .addUserOption(o => o.setName('racer').setDescription('the racer to measure yourself against')))
        // Spreadsheets (src/sheets.js)
        .addSubcommand(sub => sub.setName('export').setDescription('download saved times as a CSV for spreadsheets')
            .addStringOption(o => o.setName('board').setDescription('only this arcade event or scenario').setAutocomplete(true))
            .addUserOption(o => o.setName('racer').setDescription("only this racer's times")))
        .addSubcommand(sub => sub.setName('import').setDescription('add times from a CSV laid out like /times export')
            .addAttachmentOption(o => o.setName('file').setDescription('a .csv with the same headers as an export').setRequired(true))),
    async execute({ interaction } = {}) {
        const sub = interaction.options.getSubcommand()
        if (sub == 'export' || sub == 'import') return sheet(interaction, sub)
        if (sub == 'rival') {
            const rival = interaction.options.getUser('racer')
            const current = records.rivalOf(interaction.user.id)
            if (!rival) {
                if (!current) return reply(interaction, "You don't have a rival. Pick one with **/times rival racer:**.")
                await records.setRival(interaction.user.id, null)
                return reply(interaction, `<@${current}> is no longer your rival.`)
            }
            if (rival.id == interaction.user.id) return reply(interaction, "You can't be your own rival (though it's a nice thought).")
            if (rival.bot) return reply(interaction, "Bots don't race.")
            await records.setRival(interaction.user.id, rival.id)
            return reply(interaction, `${emoji.named('rival')} <@${rival.id}> is your rival${current && current != rival.id ? ` (instead of <@${current}>)` : ''}. Your timesheet and your receipts will show how you compare.`)
        }
        if (sub == 'youtube') {
            if (!records.canSubmitForOthers(interaction.member)) return reply(interaction, 'Only server managers and submitters can link YouTube channels.')
            const { videos, VIDEO } = require('../replays.js')
            const id = [...interaction.options.getString('video').matchAll(VIDEO)][0]?.[1]
            const racer = interaction.options.getUser('racer')
            const v = id && (await videos([id]).catch(() => ({})))[id]
            if (!v?.channelId) return reply(interaction, "Couldn't find that video's channel. Paste a YouTube video link.")
            await records.linkYoutube(v.channelId, { user: racer.id, name: v.channelName, by: interaction.user.id })
            const moved = await records.moveYoutubeTimes(v.channelId, racer.id)
            return reply(interaction, `${v.channelName}'s videos are now <@${racer.id}>'s runs.${moved ? ` Moved ${moved} time${moved == 1 ? '' : 's'} already saved from them.` : ''}`)
        }
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
            if (seconds == null) return reply(interaction, "That isn't a time. Use minutes:seconds like 1:08.92, or just the digits like 10892.")
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
        if (interaction.options.getFocused(true).name == 'board') {
            return interaction.respond(require('./submit.js').boards().filter(b => b.name.toLowerCase().includes(q)).slice(0, 25))
        }
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
