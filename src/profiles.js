// Racers' display names and avatars, for readers of the database outside Discord (the community website): kept at
// profiles/<discord id> { name, avatar, updated } for everyone with a time, a credits balance or a linked staff time.
// Names come from the main server (its nicknames), else the Discord account. Refreshed when the bot starts and
// hourly (bot.js), writing only what changed. A testing copy leaves it alone: it shares the database but sees the test
// server's members.
const { database } = require('./firebase.js')
const records = require('./records.js')
const credits = require('./credits.js')
const data = require('./swgr/data.js')

exports.refresh = async (client, guild) => {
    if (!database || !guild) return 0
    const ids = new Set([
        ...records.allTimes().map(t => t.user),
        ...credits.balances().map(b => b.user),
        ...data.events.flatMap(e => records.staffTimes(e.id).map(s => s.user)),
    ].filter(records.isDiscord))
    const current = (await database.ref('profiles').get()).val() ?? {}
    const members = await guild.members.fetch().catch(() => guild.members.cache)
    const updates = {}
    for (const id of ids) {
        const member = members.get(id)
        const user = member?.user ?? await client.users.fetch(id).catch(() => null)
        if (!user) continue
        const profile = { name: member?.displayName ?? user.displayName ?? user.username, avatar: (member ?? user).displayAvatarURL({ extension: 'png', size: 128 }) }
        const old = current[id]
        if (!old || old.name != profile.name || old.avatar != profile.avatar) updates[id] = { ...profile, updated: Date.now() }
    }
    if (Object.keys(updates).length) await database.ref('profiles').update(updates)
    return Object.keys(updates).length
}
