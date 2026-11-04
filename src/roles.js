// Achievement roles, given and taken by the bot as arcade times change. Matched by name, like the backer roles, and
// created when missing (the bot needs Manage Roles, and its own role above these):
//   champions  the #1 of the points standings (records.points) over the main 50 events, each category and each speeder
//              class (podracers are the Podracing category already); racers level on points and places share it
//   Gold Standard        gold on every one of the main 50 events
//   World Record Holder  first on any arcade event's leaderboard (Deluxe too), any full-game category's, or any
//                        scenario's with 5 or more racers on it
//   sweeps     the most points there are on a cumulative board (data.boardSets: all 50, Arcade Sweep, or a category,
//              "Acid Sweep", Deluxe too) or a speeder class's main events ("Speeder Bike Sweep", like its champion):
//              1st on every one of its events, each with 5 or more racers. Permanent: a sweep
//              is kept at sweeps/<discord id>/<set id> (when, ms) and the role stays after the records fall.
// Only Discord members can hold them: a time from an unlinked speedrun.com account (records.isDiscord) leaves its role
// empty until they join and link. Proof doesn't matter. sync() runs when the times change (records.onChange) and when
// someone joins; the first one after a start is quiet, later ones announce each role gained with an embed in
// ANNOUNCE_CHANNEL_ID (TEST_CHANNEL_ID while testing), as Botto does, and take roles from those who lost them silently.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js')
const { testing } = require('../config.js')
const { main_guild, test_guild } = require('./data/discord/guild.js')
const { announce_channel, test_channel } = require('./data/discord/channel.js')
const emoji = require('./data/discord/emoji.js')
const records = require('./records.js')
const data = require('./swgr/data.js')

const { database } = require('./firebase.js')

const MAIN = data.boardSet('main').items
const CLASSES = ['Landspeeder', 'Speeder Bike', 'Skim Speeder']

// Clean sweeps: the sets each racer holds every event's record on now (boards of SWEEP_RACERS or more), and those kept
// in the database from before ({ <discord id>: { <set id>: ms } })
const SWEEP_RACERS = 5
const SWEEP_SETS = [...data.boardSets, ...CLASSES.map(c => ({ id: c, name: c, items: MAIN.filter(e => e.vehicleClass == c), vehicleClass: true }))]
let sweeps = {}
const sweepingNow = () => SWEEP_SETS.flatMap(set => {
    const firsts = set.items.map(e => records.leaderboard('arcade', e.id)).map(b => b.length >= SWEEP_RACERS ? b[0].user : null)
    return firsts[0] && firsts.every(u => u == firsts[0]) ? [{ user: firsts[0], set: set.id }] : []
})
// Saves sweeps not kept yet (a testing copy only remembers them: it shares the database); returns the new ones
async function keepSweeps() {
    const fresh = sweepingNow().filter(s => records.isDiscord(s.user) && !sweeps[s.user]?.[s.set])
    for (const s of fresh) {
        ;(sweeps[s.user] ??= {})[s.set] = Date.now()
        if (!testing) await database?.ref(`sweeps/${s.user}/${s.set}`).set(sweeps[s.user][s.set])
    }
    return fresh
}

// Colors by tier, rarest brightest: sweeps kyber violet, the Arcade Champion gold, the other champions amber, Gold
// Standard medal gold, World Record Holder bronze. Set when a role is created and put back on each sync if changed.
const COLORS = { sweep: 0xB18CFF, arcade: 0xFFD700, champion: 0xF08A24, gold: 0xD4AF37, record: 0xCD7F32 }

// { key, name, description, color, holders(): [user ids], board?: a View board custom id, single?: one holder at a time }
const leaders = events => {
    const ranked = records.points('arcade', events.map(e => e.id))
    return ranked.filter(s => s.rank == 1).map(s => s.user)
}
const ROLES = [
    { key: 'main', name: 'Arcade Champion', color: COLORS.arcade, description: `Leads the points standings over all ${MAIN.length} events`, holders: () => leaders(MAIN), board: records.boardView('aggregate', 'main'), single: true },
    ...data.boardSets.filter(s => s.category && s.id != 'Deluxe').map(s => ({
        key: s.id, name: `${s.name} Champion`, color: COLORS.champion, description: `Leads the ${s.name} points standings`, holders: () => leaders(s.items), board: records.boardView('aggregate', s.id), single: true,
    })),
    ...CLASSES.map(c => ({
        key: c, name: `${c} Champion`, color: COLORS.champion, description: `Leads the points standings over the ${c} events`, holders: () => leaders(MAIN.filter(e => e.vehicleClass == c)), single: true,
    })),
    {
        key: 'gold', name: 'Gold Standard', color: COLORS.gold, description: `Gold on all ${MAIN.length} events`,
        holders: () => {
            const golds = MAIN.map(e => new Set(records.leaderboard('arcade', e.id).filter(t => t.time <= e.medals.gold.seconds).map(t => t.user)))
            return [...golds[0]].filter(u => golds.every(g => g.has(u)))
        },
    },
    {
        key: 'record', name: 'World Record Holder', color: COLORS.record, description: 'Holds an arcade, scenario or full-game world record',
        holders: () => [...new Set([...data.events.map(e => ['arcade', e.id]), ...data.fullGame.map(c => ['fullgame', c.id]), ...data.scenarios.map(s => ['scenario', s.id, 5])]
            .map(([kind, target, racers = 1]) => (board => board.length >= racers ? board[0].user : null)(records.leaderboard(kind, target))).filter(Boolean))],
    },
    ...SWEEP_SETS.map(s => ({
        key: `sweep:${s.id}`, name: `${s.id == 'main' ? 'Arcade' : s.name} Sweep`, color: COLORS.sweep, board: s.vehicleClass ? undefined : records.boardView('aggregate', s.id),
        description: `1st on every ${s.id == 'main' ? `one of the ${MAIN.length}` : s.name} event${s.id == 'main' ? 's' : ''}, each with ${SWEEP_RACERS}+ racers: the most points there are`,
        holders: () => Object.keys(sweeps).filter(u => sweeps[u][s.id]),
    })),
]
exports.ROLES = ROLES

// Who should hold each role: { key: Set of Discord ids }
exports.holders = () => Object.fromEntries(ROLES.map(r => [r.key, new Set(r.holders().filter(records.isDiscord))]))

let synced = false, queue = Promise.resolve()
// One sync at a time; returns once this one has run
exports.sync = client => queue = queue.then(() => run(client)).catch(error => console.error('[roles]', error))

async function run(client) {
    const guild = client.guilds.cache.get(testing ? test_guild : main_guild)
    if (!guild || !records.loaded()) return  // before the times load everyone would lose everything
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) return console.error('[roles] no Manage Roles permission')
    const quiet = !synced
    if (!synced) {
        await guild.members.fetch()  // fills the member cache that role.members reads (GuildMembers intent)
        sweeps = (await database?.ref('sweeps').get())?.val() ?? {}
    }
    synced = true
    await keepSweeps()
    const should = exports.holders()
    const gained = []
    for (const r of ROLES) {
        let role = guild.roles.cache.find(x => x.name == r.name)
        if (!role) role = await guild.roles.create({ name: r.name, colors: { primaryColor: r.color }, reason: 'Achievement role (Autopilot)' }).catch(error => console.error(`[roles] creating ${r.name}`, error.message))
        if (!role) continue
        if (role.colors.primaryColor != r.color) await role.setColors({ primaryColor: r.color }, 'Achievement role tier color').catch(error => console.error(`[roles] coloring ${r.name}`, error.message))
        const holding = new Set(role.members.keys())
        const lost = [...holding].filter(id => !should[r.key].has(id))
        for (const id of lost) await role.members.get(id).roles.remove(role, 'Achievement role lost').catch(error => console.error(`[roles] ${r.name}`, error.message))
        for (const id of should[r.key]) {
            if (holding.has(id)) continue
            const member = guild.members.cache.get(id)
            if (!member) continue  // not on the server
            const added = await member.roles.add(role, 'Achievement role gained').then(() => true, error => console.error(`[roles] ${r.name}`, error.message))
            if (added) gained.push({ r, role, member, from: r.single ? lost : [] })
        }
    }
    if (quiet || !gained.length) return
    const channelId = testing ? test_channel : announce_channel
    const channel = channelId && await client.channels.fetch(channelId).catch(() => null)
    for (const g of gained) await channel?.send(exports.announcement(g)).catch(error => console.error('[roles] announce', error.message))
}

// Botto's achievement embed: who, the role, what it's for (and who it was taken from), and the board it's held on
exports.announcement = ({ r, role, member, from }) => {
    const taken = from.length ? `, taking it from ${from.map(records.who).join(' and ')}` : ''
    const embed = new EmbedBuilder()
        .setAuthor({ name: `${member.displayName} got an achievement!`, iconURL: member.displayAvatarURL() })
        .setTitle(`${r.single ? emoji.named('crown') : r.key == 'gold' ? emoji.medal.gold : emoji.named('place_1')} ${r.name}`)
        .setDescription(`<@&${role.id}> - ${r.description}${taken}`)
        .setColor(0xFFB900)
    const components = r.board ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(r.board).setLabel('View board').setStyle(ButtonStyle.Secondary))] : []
    return { embeds: [embed], components, allowedMentions: { parse: [] } }
}
