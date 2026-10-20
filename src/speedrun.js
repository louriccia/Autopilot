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
// A run is saved through src/submit.js like any other (credits, podiums, bounties), as a video-proven run credited to
// whoever the src account is linked to; a runner's time already submitted on Discord (to the hundredth) is the same run
// and only gains the video and the src link. Runs by unlinked accounts wait until the account is linked
// (/times speedrun, or automatically: the account's Discord connection names a server member, or its video's YouTube
// channel is already linked to someone), then come in all at once (backfill()).
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
    // Times already saved from this account's runs go with it
    for (const t of records.allTimes().filter(t => t.srcUser == src.id && t.user != discordId)) await records.updateTime(t.id, { user: discordId })
    return exports.backfill(src.id, guild)
}

// --- runs ---

// A run's players (embedded as { data } when the request asked for them)
const players = run => run.players?.data ?? run.players ?? []

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
        proof: run.videos?.links?.[0]?.uri ?? run.weblink,
        player: player.rel == 'user' ? player.id : null,
    }
}

// Saves one verified run for whoever its account is linked to; returns the submit result, or null when it was skipped
// (not ours, already saved, unlinked)
async function save(run, guild, { announce }) {
    if (runs[run.id]) return null
    const t = asTime(run)
    const user = t?.player && exports.owner(t.player)
    if (!t || !user) return null
    // The same run submitted on Discord: their time on the board within a hundredth (results screens and src's timing
    // can round differently)
    const same = records.allTimes().find(x => x.kind == t.kind && x.target == t.target && x.user == user && Math.abs(x.time - t.seconds) <= 0.011)
    const member = await guild?.members.fetch(user).catch(() => null)
    const { submit } = require('./submit.js')
    const r = await submit({
        kind: t.kind, target: t.target, member: member ?? { id: user, client: guild?.client, guild }, memberId: user,
        time: String(same?.time ?? t.seconds), platform: t.platform, keepPlatform: true, proof: t.proof, proofType: 'video',
        notes: '', trusted: true, date: t.date, announce, src: { run: run.id, user: t.player },
    })
    if (r.error) throw new Error(`run ${run.id}: ${r.error}`)
    const saved = records.allTimes().find(x => x.src == run.id)
    const value = { time: saved?.id ?? null, at: Date.now() }
    await database.ref(`speedrun/runs/${run.id}`).set(value)
    runs[run.id] = value
    console.log(`[speedrun] ${run.weblink}: ${r.message}`)
    return r
}

// Tries to work out whose an unlinked account is: its src profile's Discord connection naming a member of the server,
// else its run video's YouTube channel already being linked (records.youtubeOwner). Asked once per account per day.
const tried = new Map()
async function autoLink(run, guild) {
    const player = players(run)[0]
    const id = player?.rel == 'user' && player.id
    if (!id || exports.owner(id) || Date.now() - (tried.get(id) ?? 0) < 24 * 60 * 60 * 1000) return
    tried.set(id, Date.now())
    const name = player.names?.international
    if (!name) return
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
        user = channel ? records.youtubeOwner(channel) : null
    }
    if (!user) return
    console.log(`[speedrun] linked ${name} to ${user} (${discord ? 'Discord connection' : 'YouTube channel'})`)
    const value = { user, name, linkedBy: 'auto', linkedAt: Date.now() }
    await database.ref(`speedrun/users/${id}`).set(value)
    users[id] = value
    // Their earlier runs come in by the backfill
    await exports.backfill(id, guild)
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

// New verified runs since the last check: saved (podiums announced), or auto-linked first
exports.poll = async guild => {
    if (!game || !database) return 0
    const checked = (await database.ref('speedrun/checked').get()).val()
    const found = (await verifiedSince(checked ?? 0)).filter(r => game.kinds[r.category]).reverse()  // oldest first
    let saved = 0
    for (const run of found) {
        try {
            await autoLink(run, guild)
            // The very first check brings in whatever was already there without announcing it
            if (await save(run, guild, { announce: checked != null })) saved++
        } catch (error) { console.error('[speedrun]', run.weblink, error) }  // one bad run doesn't hold up the rest
    }
    const latest = Math.max(checked ?? 0, ...found.map(r => Date.parse(r.status['verify-date'])))
    if (latest != checked) await database.ref('speedrun/checked').set(latest)
    return saved
}

// All of one account's verified runs (when it's linked); not announced, like other backfills
exports.backfill = async (srcId, guild) => {
    if (!game) return 0
    let saved = 0
    for (let offset = 0; ; offset += 200) {
        const page = await get(`/runs?game=${game.id}&user=${srcId}&status=verified&orderby=date&direction=asc&max=200&offset=${offset}`)
        for (const run of page.data) if (await save(run, guild, { announce: false })) saved++
        if (page.data.length < 200) return saved
    }
}
