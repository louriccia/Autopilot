// Community times and feedback for arcade events and scenarios, kept in the database and always keyed by Discord id
// (like Botto), never by name:
//   times/<push id>                     { kind, target, user, submittedBy, time (s), platform, proof, notes, date }
//   feedback/<kind>/<target>/<user>     { rating: up | neutral | down, date }
//   submitters/<discord id>             { addedBy, addedAt }: may submit times for other people
//   staff/<event id>/<name>              { seconds, from: developer | publisher }: staff times on arcade cards
//                                       (by name: staff aren't necessarily on the server; /times staff)
// kind is 'arcade' (target = event id) or 'scenario' (target = scenario id). Pages read the in-memory copies below,
// kept current by listeners that start with the bot (listen()), so building a card never waits on the database.
const { PermissionFlagsBits } = require('discord.js')
const { database } = require('./firebase.js')

let times = {}, feedback = {}, submitters = {}, staff = {}
exports.listen = () => {
    if (!database) return
    database.ref('times').on('value', s => { times = s.val() ?? {} })
    database.ref('feedback').on('value', s => { feedback = s.val() ?? {} })
    database.ref('submitters').on('value', s => { submitters = s.val() ?? {} })
    database.ref('staff').on('value', s => { staff = s.val() ?? {} })
}

// "1:08.92", "68.92", "1:01:08.9" -> seconds to the hundredth (the game's precision); null if it isn't a time
exports.parseTime = text => {
    const m = String(text ?? '').trim().match(/^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2}(?:\.\d+)?)$/)
    if (!m) return null
    const [h, mi] = m[2] != null ? [Number(m[1]), Number(m[2])] : [0, Number(m[1] ?? 0)]
    if ((m[1] != null && Number(m[3]) >= 60) || (m[2] != null && mi >= 60)) return null  // "1:75" isn't a time
    const seconds = h * 3600 + mi * 60 + Number(m[3])
    return seconds > 0 && seconds < 24 * 3600 ? Math.round(seconds * 100) / 100 : null
}

// Each person's best time, fastest first
exports.leaderboard = (kind, target) => {
    const best = {}
    for (const [id, t] of Object.entries(times)) {
        if (t.kind != kind || t.target != target) continue
        if (!best[t.user] || t.time < best[t.user].time) best[t.user] = { id, ...t }
    }
    return Object.values(best).sort((a, b) => a.time - b.time || a.date - b.date)
}

// Totals across several boards (an arcade category): each person's best on every one of them, summed; only people
// with a time on all of them are ranked. Also returns how many of the boards each person has a time on.
exports.cumulative = (kind, targets) => {
    const bests = targets.map(t => Object.fromEntries(exports.leaderboard(kind, t).map(x => [x.user, x.time])))
    const users = new Set(bests.flatMap(b => Object.keys(b)))
    const done = {}, ranked = []
    for (const u of users) {
        done[u] = bests.filter(b => b[u] != null).length
        if (done[u] == targets.length) ranked.push({ user: u, time: Math.round(bests.reduce((n, b) => n + b[u], 0) * 100) / 100 })
    }
    ranked.sort((a, b) => a.time - b.time).forEach((r, i) => { r.rank = i + 1 })
    return { ranked, done }
}

exports.feedbackCounts = (kind, target) => {
    const counts = { up: 0, neutral: 0, down: 0 }
    for (const f of Object.values(feedback[kind]?.[target] ?? {})) counts[f.rating] = (counts[f.rating] ?? 0) + 1
    return counts
}

// The platform someone last submitted on, to prefill the next submission
// The platforms a time can be on: the form's and /submit's fixed choices
exports.PLATFORMS = ['PC', 'PS5', 'Xbox']

exports.lastPlatform = user => Object.values(times).filter(t => t.user == user && exports.PLATFORMS.includes(t.platform)).sort((a, b) => b.date - a.date)[0]?.platform ?? ''

// A member's platform from the server's console roles ("PC Player", "PlayStation Player", "XBOX Player"), matched by
// name so any server's roles work; only when they have exactly one
const ROLE_PLATFORMS = [['PC', /\bPC\b|Steam/i], ['PS5', /PlayStation|\bPS5?\b/i], ['Xbox', /Xbox/i]]
exports.rolePlatform = member => {
    const names = member?.roles?.cache?.map(r => r.name) ?? []
    const found = ROLE_PLATFORMS.filter(([, re]) => names.some(n => re.test(n)))
    return found.length == 1 ? found[0][0] : ''
}
// The platform a time defaults to: their last submission's, else their console role's
exports.defaultPlatform = (user, member) => exports.lastPlatform(user) || exports.rolePlatform(member)

// Server managers, and anyone on the submitters list, may submit for others
exports.canSubmitForOthers = member => !!(member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) || submitters[member?.id ?? member?.user?.id])

// Saves a time. If the same person already has that exact time on that board, it isn't saved twice: any new
// details (platform, proof, notes) given this time replace the old ones instead, and blank ones keep what was there.
// Returns { id, duplicate, updated: [the detail fields that changed] }.
const DETAILS = ['platform', 'proof', 'notes']
exports.addTime = async entry => {
    const same = Object.entries(times).find(([, t]) => t.kind == entry.kind && t.target == entry.target && t.user == entry.user && t.time == entry.time)
    if (same) {
        const [id, old] = same
        const changes = Object.fromEntries(DETAILS.filter(f => entry[f] && entry[f] != old[f]).map(f => [f, entry[f]]))
        if (Object.keys(changes).length) {
            await database.ref(`times/${id}`).update(changes)
            times[id] = { ...old, ...changes }
        }
        return { id, duplicate: true, updated: Object.keys(changes) }
    }
    const ref = await database.ref('times').push({ ...entry, date: Date.now() })
    times[ref.key] = { ...entry, date: Date.now() }  // so the card that's redrawn next already shows it
    return { id: ref.key, duplicate: false }
}

// Pressing the rating you already gave takes it back
exports.rate = async (kind, target, user, rating) => {
    const ref = database.ref(`feedback/${kind}/${target}/${user}`)
    const same = feedback[kind]?.[target]?.[user]?.rating == rating
    const value = same ? null : { rating, date: Date.now() }
    await ref.set(value)
    feedback[kind] ??= {}
    feedback[kind][target] ??= {}
    if (value) feedback[kind][target][user] = value
    else delete feedback[kind][target][user]
    return !same
}

exports.submitters = () => submitters

// Every saved time, newest first, with its id
exports.allTimes = () => Object.entries(times).map(([id, t]) => ({ id, ...t })).sort((a, b) => b.date - a.date)

exports.removeTime = async id => {
    await database.ref(`times/${id}`).remove()
    delete times[id]
}

// Staff times for an arcade event, from the community leaderboard sheet's highlighted staff entries
exports.staffTimes = event => Object.entries(staff[event] ?? {}).map(([key, s]) => ({ name: s.name ?? key, ...s }))

// Firebase keys can't hold . # $ [ ] /
const staffKey = name => name.replace(/[.#$\[\]/]/g, '_')
exports.setStaffTime = async (event, name, seconds, from) => {
    const value = { name, seconds, from }
    await database.ref(`staff/${event}/${staffKey(name)}`).set(value)
    ;(staff[event] ??= {})[staffKey(name)] = value
}
exports.removeStaffTime = async (event, name) => {
    const key = Object.keys(staff[event] ?? {}).find(k => k == staffKey(name) || staff[event][k].name?.toLowerCase() == name.toLowerCase())
    if (!key) return false
    await database.ref(`staff/${event}/${key}`).remove()
    delete staff[event][key]
    return true
}
