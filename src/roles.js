// Achievement roles, given and taken by the bot as arcade times change. Matched by name, like the backer roles, and
// created when missing (the bot needs Manage Roles, and its own role above these):
//   champions  the #1 of the points standings (records.points) over the main 50 events, each category and each speeder
//              class (podracers are the Podracing category already); racers level on points and places share it
//   Gold Standard        gold on every one of the main 50 events
//   World Record Holder  first on any arcade event's leaderboard (Deluxe too) or any full-game category's
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

const MAIN = data.boardSet('main').items
const CLASSES = ['Landspeeder', 'Speeder Bike', 'Skim Speeder']

// { key, name, description, holders(): [user ids], board?: a View board custom id, single?: one holder at a time }
const leaders = events => {
    const ranked = records.points('arcade', events.map(e => e.id))
    return ranked.filter(s => s.rank == 1).map(s => s.user)
}
const ROLES = [
    { key: 'main', name: 'Arcade Champion', description: `Leads the points standings over all ${MAIN.length} events`, holders: () => leaders(MAIN), board: records.boardView('aggregate', 'main'), single: true },
    ...data.boardSets.filter(s => s.category && s.id != 'Deluxe').map(s => ({
        key: s.id, name: `${s.name} Champion`, description: `Leads the ${s.name} points standings`, holders: () => leaders(s.items), board: records.boardView('aggregate', s.id), single: true,
    })),
    ...CLASSES.map(c => ({
        key: c, name: `${c} Champion`, description: `Leads the points standings over the ${c} events`, holders: () => leaders(MAIN.filter(e => e.vehicleClass == c)), single: true,
    })),
    {
        key: 'gold', name: 'Gold Standard', description: `Gold on all ${MAIN.length} events`,
        holders: () => {
            const golds = MAIN.map(e => new Set(records.leaderboard('arcade', e.id).filter(t => t.time <= e.medals.gold.seconds).map(t => t.user)))
            return [...golds[0]].filter(u => golds.every(g => g.has(u)))
        },
    },
    {
        key: 'record', name: 'World Record Holder', description: 'Holds an arcade or full-game world record',
        holders: () => [...new Set([...data.events.map(e => ['arcade', e.id]), ...data.fullGame.map(c => ['fullgame', c.id])]
            .map(([kind, target]) => records.leaderboard(kind, target)[0]?.user).filter(Boolean))],
    },
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
    if (!synced) await guild.members.fetch()  // fills the member cache that role.members reads (GuildMembers intent)
    synced = true
    const should = exports.holders()
    const gained = []
    for (const r of ROLES) {
        let role = guild.roles.cache.find(x => x.name == r.name)
        if (!role) role = await guild.roles.create({ name: r.name, reason: 'Achievement role (Autopilot)' }).catch(error => console.error(`[roles] creating ${r.name}`, error.message))
        if (!role) continue
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
