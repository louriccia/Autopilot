// Community times and feedback for arcade events and scenarios, kept in the database and always keyed by Discord id
// (like Botto), never by name:
//   times/<push id>                     { kind, target, user, submittedBy, time (s), platform, proof, notes, date }
//   feedback/<kind>/<target>/<user>     { rating: up | neutral | down, date }
//   submitters/<discord id>             { addedBy, addedAt }: may submit times for other people
// kind is 'arcade' (target = event id) or 'scenario' (target = scenario id). Pages read the in-memory copies below,
// kept current by listeners that start with the bot (listen()), so building a card never waits on the database.
const { PermissionFlagsBits } = require('discord.js')
const { database } = require('./firebase.js')

let times = {}, feedback = {}, submitters = {}
exports.listen = () => {
    if (!database) return
    database.ref('times').on('value', s => { times = s.val() ?? {} })
    database.ref('feedback').on('value', s => { feedback = s.val() ?? {} })
    database.ref('submitters').on('value', s => { submitters = s.val() ?? {} })
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

exports.feedbackCounts = (kind, target) => {
    const counts = { up: 0, neutral: 0, down: 0 }
    for (const f of Object.values(feedback[kind]?.[target] ?? {})) counts[f.rating] = (counts[f.rating] ?? 0) + 1
    return counts
}

// The platform someone last submitted on, to prefill the next submission
exports.lastPlatform = user => Object.values(times).filter(t => t.user == user && t.platform).sort((a, b) => b.date - a.date)[0]?.platform ?? ''

// Server managers, and anyone on the submitters list, may submit for others
exports.canSubmitForOthers = member => !!(member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) || submitters[member?.id ?? member?.user?.id])

exports.addTime = async entry => {
    const ref = await database.ref('times').push({ ...entry, date: Date.now() })
    times[ref.key] = { ...entry, date: Date.now() }  // so the card that's redrawn next already shows it
    return ref.key
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
