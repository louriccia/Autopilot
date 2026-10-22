// speedrun.com (src): the game's individual-level boards mirror ours, so verified runs there are saved here as times,
// and cards link to the board they match ("View on src").
// The game (SRC_GAME, default Star_Wars_Galactic_Racer) has two per-level categories, Arcade and Scenarios, each a
// subcategory variable with a value per event / scenario (on its one level, "Event Time"); values are matched to ours by
// name when the bot starts (load()), so nothing here hardcodes src's ids.
//
// Database (the live bot only polls, since a testing copy shares the database):
//   speedrun/users/<src user id>   { user (discord id), name (src name), linkedBy, linkedAt }: whose runs a src account's are
//   speedrun/runs/<src run id>     { time (our times/ id) | null, at }: runs already saved, so a removed time stays removed
//   speedrun/checked               the latest verify-date (ms) seen by poll()
// Every verified run is saved through src/submit.js like any other, as a video-proven run. One by an account linked to
// a Discord id is theirs (credits, podiums, bounties), and a time they already submitted on Discord (to the hundredth)
// is the same run, which only gains the video and the src fields. One by an account nobody has linked yet is saved
// under 'src:<src user id>' ('src:guest:<name>' for guests; records.who shows the src name), on the boards and in
// podium posts but earning nothing. Linking (/times speedrun, or automatically: the account's Discord connection names
// a server member, or its video's YouTube channel is already linked to someone) saves those runs again as the person's
// (link()), so they're deduplicated against their own times and paid like any other save, without announcements.
const { database } = require('./firebase.js')
const records = require('./records.js')

const GAME = process.env.SRC_GAME || 'Star_Wars_Galactic_Racer'
const API = 'https://www.speedrun.com/api/v1'
exports.POLL_EVERY = 10 * 60 * 1000

let game = null  // { id, weblink, boards: { 'arcade:<id>': { category, level, variable, value } }, kinds: { <category id>: 'arcade' | 'scenario' }, platforms: { <value id>: 'PC' | 'PS5' | 'Xbox' } }
let users = {}, runs = {}

const get = async path => {
    const res = await fetch(API + path, { headers: { 'User-Agent': 'Autopilot (Star Wars: Galactic Racer Discord bot)' } })
    if (!res.ok) throw new Error(`speedrun.com ${path}: ${res.status}`)
    return res.json()
}
const key = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '')

// The game's categories and subcategory values, matched to our events and scenarios by name
exports.load = async () => {
    const data = require('./swgr/data.js')
    const g = (await get(`/games/${GAME}?embed=categories,levels,variables`)).data
    const level = g.levels.data[0]?.id
    const boards = {}, kinds = {}
    for (const [kind, name, items] of [['arcade', 'Arcade', data.events], ['scenario', 'Scenarios', data.scenarios]]) {
        const category = g.categories.data.find(c => c.type == 'per-level' && key(c.name) == key(name))
        const variable = category && g.variables.data.find(v => v['is-subcategory'] && v.category == category.id)
        if (!variable) continue
        kinds[category.id] = kind
        for (const [value, v] of Object.entries(variable.values.values)) {
            const item = items.find(i => key(i.name) == key(v.label))
            if (item) boards[`${kind}:${item.id}`] = { category: category.id, level, variable: variable.id, value }
        }
    }
    // The Platform variable's values as our three platforms
    const platforms = {}
    for (const v of g.variables.data.filter(v => key(v.name) == 'platform')) {
        for (const [id, { label }] of Object.entries(v.values.values)) {
            platforms[id] = /PC/i.test(label) ? 'PC' : /PS|PlayStation/i.test(label) ? 'PS5' : /Xbox/i.test(label) ? 'Xbox' : ''
        }
    }
    game = { id: g.id, weblink: g.weblink, boards, kinds, platforms }
    if (database) {
        database.ref('speedrun/users').on('value', s => { users = s.val() ?? {} })
        database.ref('speedrun/runs').on('value', s => { runs = s.val() ?? {} })
    }
    return Object.keys(boards).length
}

// The src board for one of our boards ("View on src"); null until load() has run or for a board src doesn't have
exports.boardUrl = (kind, target) => {
    const b = game?.boards[`${kind}:${target}`]
    return b ? `${game.weblink}?x=l_${b.level}-${b.category}-${b.variable}.${b.value}` : null
}

// --- accounts ---

// A src account by name, profile link or id: { id, name, weblink } or null
exports.findUser = async text => {
    const name = String(text ?? '').trim().replace(/^.*speedrun\.com\/(?:users?|u)\//i, '').replace(/[/?#].*$/, '')
    if (!name) return null
    const u = await get(`/users/${encodeURIComponent(name)}`).catch(() => null)
    return u && { id: u.data.id, name: u.data.names.international, weblink: u.data.weblink }
}
// The Discord account a src profile names under its connections (as "name" or the old "Name#1234"), lowercased
exports.discordOf = async name => {
    const res = await fetch(`https://www.speedrun.com/api/v2/GetUserSummary?url=${encodeURIComponent(name)}`).catch(() => null)
    const body = res?.ok ? await res.json().catch(() => null) : null
    const value = body?.userSocialConnectionList?.find(c => c.networkId == 5)?.value  // 5: Discord
    return value ? value.replace(/#\d{4}$/, '').toLowerCase() : null
}
exports.owner = srcId => users[srcId]?.user ?? null
exports.accountOf = discordId => Object.entries(users).find(([, u]) => u.user == discordId)?.[0] ?? null

// Links a src account to a Discord id and brings in its runs (backfill). Returns how many runs were saved.
exports.link = async (src, discordId, { by, guild } = {}) => {
    const value = { user: discordId, name: src.name, linkedBy: by ?? null, linkedAt: Date.now() }
    await database.ref(`speedrun/users/${src.id}`).set(value)
    users[src.id] = value
    for (const t of records.allTimes().filter(t => t.srcUser == src.id && t.user != discordId)) {
        if (records.isDiscord(t.user)) await records.updateTime(t.id, { user: discordId })  // a relink: their times move
        else {
            // Saved before anyone linked it: forgotten here, so the backfill saves it again as theirs
            await records.removeTime(t.id)
            await database.ref(`speedrun/runs/${t.src}`).remove()
            delete runs[t.src]
        }
    }
    return exports.backfill(src.id, guild)
}

// --- runs ---

// A run's players (embedded as { data } when the request asked for them)
const players = run => run.players?.data ?? run.players ?? []

// A run's video link as typed on src, without what runners leave around it (a trailing ")" or "." from pasting it
// markdown-style, which breaks the [time](<link>) on our boards)
const cleanLink = uri => {
    let link = String(uri ?? '').trim().replace(/^<|>$/g, '')
    while (/[).,\]>]$/.test(link) && !(link.endsWith(')') && link.split('(').length >= link.split(')').length)) link = link.slice(0, -1)
    return link
}

// A verified src run as one of our times: { kind, target, seconds, platform, proof, date, player } or null when it isn't
// on a board we have
function asTime(run) {
    const kind = game.kinds[run.category]
    const board = kind && Object.entries(game.boards).find(([, b]) => b.category == run.category && run.values?.[b.variable] == b.value)
    if (!board || players(run).length != 1) return null
    // The game's own clock when the run has it, else src's primary time
    const seconds = Math.round((run.times.ingame_t || run.times.primary_t) * 100) / 100
    if (!(seconds > 0)) return null
    const platform = Object.values(run.values ?? {}).map(v => game.platforms[v]).find(Boolean) ?? ''
    // run.date is the day it was run; the submission time when that's the same day
    const submitted = Date.parse(run.submitted ?? '')
    const date = run.date && new Date(submitted || 0).toISOString().slice(0, 10) != run.date ? Date.parse(`${run.date}T12:00:00Z`) : submitted || Date.now()
    const player = players(run)[0]
    return {
        kind, target: board[0].split(':')[1], seconds, platform, date,
        proof: cleanLink(run.videos?.links?.[0]?.uri) || run.weblink,
        player: player.rel == 'user' ? player.id : null,
        name: player.rel == 'user' ? player.names?.international ?? null : player.name,
        // Who it's saved for: the linked Discord id, else the placeholder
        racer: player.rel == 'user' ? exports.owner(player.id) ?? `src:${player.id}` : `src:guest:${player.name}`,
    }
}

// Saves one verified run for whoever its account is linked to; returns the submit result, or null when it was skipped
// (not ours, already saved)
async function save(run, guild, { announce }) {
    if (runs[run.id]) return null
    const t = asTime(run)
    if (!t) return null
    const user = t.racer, linked = records.isDiscord(user)
    // The same run submitted on Discord: their time on the board within a hundredth (results screens and src's timing
    // can round differently)
    const same = records.allTimes().find(x => x.kind == t.kind && x.target == t.target && x.user == user && Math.abs(x.time - t.seconds) <= 0.011)
    const member = linked ? await guild?.members.fetch(user).catch(() => null) : null
    const { submit, formatTime } = require('./submit.js')
    const r = await submit({
        kind: t.kind, target: t.target, member: member ?? { id: user, client: guild?.client, guild }, memberId: user,
        // "1:43.67": plain seconds only parse under a minute
        time: formatTime(same?.time ?? t.seconds), platform: t.platform, keepPlatform: true, proof: t.proof, proofType: 'video',
        notes: '', trusted: true, date: t.date, announce, pay: linked, src: { run: run.id, user: t.player, name: t.name },
    })
    if (r.error) throw new Error(`run ${run.id}: ${r.error}`)
    const saved = records.allTimes().find(x => x.src == run.id)
    // The verified run's proof replaces whatever the time had (submit only swaps a video for another video); the date
    // stays the earliest known (records.addTime)
    if (saved && t.proof && saved.proof != t.proof) await records.updateTime(saved.id, { proof: t.proof })
    const value = { time: saved?.id ?? null, at: Date.now() }
    await database.ref(`speedrun/runs/${run.id}`).set(value)
    runs[run.id] = value
    console.log(`[speedrun] ${run.weblink}: ${r.message}`)
    return r
}

// A proof link's video: the YouTube id when it's a YouTube link, else the link itself
const videoKey = url => {
    const { VIDEO } = require('./replays.js')
    return [...String(url ?? '').matchAll(VIDEO)][0]?.[1] ?? (url || null)
}

// The server member a src run is evidently also theirs, when exactly one fits: a Discord time on the same board with
// the same proof video, else one with the same time (within a hundredth) by a member whose username, display name or
// server nickname is the src name (ignoring case)
async function sameRunner({ kind, target, seconds, proof, name }, guild) {
    const board = records.allTimes().filter(x => records.isDiscord(x.user) && x.kind == kind && x.target == target)
    const video = videoKey(proof)
    const sameVideo = new Set(board.filter(x => video && videoKey(x.proof) == video).map(x => x.user))
    if (sameVideo.size == 1) return [...sameVideo][0]
    if (!guild || !name) return null
    const candidates = new Set(board.filter(x => Math.abs(x.time - seconds) <= 0.011).map(x => x.user))
    const named = []
    for (const id of candidates) {
        const m = await guild.members.fetch(id).catch(() => null)
        if (m && [m.user.username, m.user.globalName, m.displayName].some(n => n?.toLowerCase() == name.toLowerCase())) named.push(id)
    }
    return named.length == 1 ? named[0] : null
}

// Tries to work out whose an unlinked account is: the same run already submitted on Discord (sameRunner, every run),
// else (once per account per day) its src profile's Discord connection naming a member of the server, else its run
// video's YouTube channel belonging to someone (records.youtubeOwner, or the times already saved from it)
const tried = new Map()
async function autoLink(run, guild) {
    const player = players(run)[0]
    const id = player?.rel == 'user' && player.id
    const name = player?.names?.international
    if (!id || !name || exports.owner(id)) return
    const t = asTime(run)
    const match = t && await sameRunner(t, guild)
    if (match) {
        console.log(`[speedrun] linked ${name} to ${match} (the same run on Discord)`)
        return exports.link({ id, name }, match, { by: 'auto', guild })
    }
    if (Date.now() - (tried.get(id) ?? 0) < 24 * 60 * 60 * 1000) return
    tried.set(id, Date.now())
    let user = null
    const discord = await exports.discordOf(name)
    if (discord && guild) {
        const found = await guild.members.fetch({ query: discord, limit: 10 }).catch(() => null)
        user = found?.find(m => m.user.username.toLowerCase() == discord)?.id ?? null
    }
    if (!user) {
        const { videos, VIDEO } = require('./replays.js')
        const video = [...String(run.videos?.links?.[0]?.uri ?? '').matchAll(VIDEO)][0]?.[1]
        const channel = video && (await videos([video]).catch(() => ({})))[video]?.channelId
        // the channel's linked owner, else whoever every time already saved from that channel belongs to
        const owners = new Set(records.allTimes().filter(x => channel && x.youtube == channel && records.isDiscord(x.user)).map(x => x.user))
        user = channel ? records.youtubeOwner(channel) ?? (owners.size == 1 ? [...owners][0] : null) : null
    }
    if (!user) return
    console.log(`[speedrun] linked ${name} to ${user} (${discord ? 'Discord connection' : 'YouTube channel'})`)
    await exports.link({ id, name }, user, { by: 'auto', guild })
}

// Every verified run of the game, newest verification first, until one verified before `since` (ms)
async function verifiedSince(since) {
    const out = []
    for (let offset = 0; ; offset += 200) {
        const page = await get(`/runs?game=${game.id}&status=verified&orderby=verify-date&direction=desc&max=200&offset=${offset}&embed=players`)
        const fresh = page.data.filter(r => Date.parse(r.status['verify-date']) > since)
        out.push(...fresh)
        if (fresh.length < page.data.length || page.data.length < 200) return out
    }
}

// New verified runs since the last check: saved (podiums announced), or auto-linked first. Then runs saved earlier
// under an unlinked account get the same-run check (sameRunner) again, for a Discord time submitted after them.
exports.poll = async guild => {
    if (!game || !database) return 0
    const checked = (await database.ref('speedrun/checked').get()).val()
    const found = (await verifiedSince(checked ?? 0)).filter(r => game.kinds[r.category]).reverse()  // oldest first
    let saved = 0, failed = null
    for (const run of found) {
        try {
            await autoLink(run, guild)
            // The very first check brings in whatever was already there without announcing it
            if (await save(run, guild, { announce: checked != null })) saved++
        } catch (error) {
            console.error('[speedrun]', run.weblink, error)  // one bad run doesn't hold up the rest
            failed ??= Date.parse(run.status['verify-date'])
        }
    }
    // Up to the newest run, or to just before the first that failed so it's tried again next time (runs saved since
    // are skipped then)
    const latest = failed ? Math.max(checked ?? 0, failed - 1) : Math.max(checked ?? 0, ...found.map(r => Date.parse(r.status['verify-date'])))
    if (latest != checked) await database.ref('speedrun/checked').set(latest)
    for (const t of records.allTimes().filter(t => t.srcUser && t.srcName && !records.isDiscord(t.user) && !exports.owner(t.srcUser))) {
        if (exports.owner(t.srcUser)) continue  // linked by an earlier time in this loop
        const match = await sameRunner({ kind: t.kind, target: t.target, seconds: t.time, proof: t.proof, name: t.srcName }, guild).catch(() => null)
        if (!match) continue
        console.log(`[speedrun] linked ${t.srcName} to ${match} (the same run on Discord)`)
        await exports.link({ id: t.srcUser, name: t.srcName }, match, { by: 'auto', guild }).catch(error => console.error('[speedrun] link', error))
    }
    return saved
}

// All of one account's verified runs (when it's linked); not announced, like other backfills
exports.backfill = async (srcId, guild) => {
    if (!game) return 0
    let saved = 0
    for (let offset = 0; ; offset += 200) {
        const page = await get(`/runs?game=${game.id}&user=${srcId}&status=verified&orderby=date&direction=asc&max=200&offset=${offset}&embed=players`)
        for (const run of page.data) if (await save(run, guild, { announce: false })) saved++
        if (page.data.length < 200) return saved
    }
}
