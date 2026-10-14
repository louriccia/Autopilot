// Live streams in the game's Twitch category, posted like Botto's: a streamer is announced once they're live with at
// least MIN_VIEWERS watching, then not again for COOLDOWN (so a dropped connection or a second session the same day
// doesn't post twice). Recognized streamers (/streamer add, kept in the database at streamers/<twitch user id>) skip
// the viewer minimum and get the big card. Uses Twitch's Helix API with an app token (TWITCH_ID / TWITCH_SECRET).
const { EmbedBuilder } = require('discord.js')
const { database } = require('../firebase.js')

const GAME = '474709880'          // STAR WARS: Galactic Racer
const COOLDOWN = 8 * 60 * 60      // seconds
const MAX_PER_CHECK = 10          // a flood (launch day, a big event) posts the most-watched ten
// The category is busy (around a hundred live at once), so other streams are announced once they reach this many
const MIN_VIEWERS = Number(process.env.TWITCH_MIN_VIEWERS || 100)
// Stream languages to announce (Twitch's language codes, comma-separated; blank = any). Recognized streamers always are.
const LANGUAGES = (process.env.TWITCH_LANGUAGES ?? 'en').split(',').map(l => l.trim().toLowerCase()).filter(Boolean)

// Recognized streamers, kept current from the database once the feed starts (not on require: the open connection
// would keep scripts like deploy-commands from exiting)
let recognized = {}
let listening = false
function listen() {
    if (listening || !database) return
    listening = true
    return new Promise(resolve => database.ref('streamers').on('value', snap => { recognized = snap.val() ?? {}; resolve() }, () => resolve()))
}

let token = null  // { value, expires (ms) }
async function helix(path) {
    if (!token || Date.now() > token.expires - 60000) {
        const res = await fetch('https://id.twitch.tv/oauth2/token', {
            method: 'POST',
            body: new URLSearchParams({ client_id: process.env.TWITCH_ID, client_secret: process.env.TWITCH_SECRET, grant_type: 'client_credentials' }),
        })
        if (!res.ok) throw new Error(`Twitch token request answered ${res.status}`)
        const t = await res.json()
        token = { value: t.access_token, expires: Date.now() + t.expires_in * 1000 }
    }
    const res = await fetch(`https://api.twitch.tv/helix/${path}`, { headers: { 'Client-Id': process.env.TWITCH_ID, Authorization: `Bearer ${token.value}` } })
    if (res.status == 401) token = null  // expired early: the next call gets a new one
    if (!res.ok) throw new Error(`Twitch ${path.split('?')[0]} answered ${res.status}`)
    return (await res.json()).data
}

const truncate = (s, n) => !s ? '' : s.length <= n ? s : `${s.slice(0, n - 1)}…`
// Botto's card: the streamer (with their picture) as the author line, the stream title linking to the stream and
// a preview frame. Recognized streamers get a white bar, the full title, a full-size frame and their tags.
function streamCard(s, user, big) {
    const frame = s.thumbnail_url.replace('{width}', big ? 1280 : 300).replace('{height}', big ? 720 : 160) + `?t=${Date.now()}`
    const embed = new EmbedBuilder()
        .setAuthor({ name: `${s.user_name} is podracing on Twitch!`, iconURL: user?.profile_image_url })
        .setTitle(truncate(s.title || '(No Title)', big ? 256 : 65))
        .setURL(`https://www.twitch.tv/${s.user_login}`)
        .setColor(big ? 0xffffff : 0x6440a5)
        .setImage(frame)
    if (big && s.tags?.length) embed.setFooter({ text: s.tags.join(' • ') })
    return { embeds: [embed] }
}

module.exports = {
    name: 'twitch',
    channel: 'streams',
    every: 3 * 60 * 1000,
    enabled: () => !!(process.env.TWITCH_ID && process.env.TWITCH_SECRET),
    helix,
    async check(seen, { preview = false } = {}) {
        await listen()
        const live = await helix(`streams?game_id=${GAME}&first=100`)  // most-watched first
        const now = Date.now() / 1000
        seen.announced ??= {}  // user id -> when they were last announced (seconds)
        for (const [id, at] of Object.entries(seen.announced)) if (now - at > COOLDOWN) delete seen.announced[id]
        // Only streams that qualify count as seen, so a small stream is announced if it grows past the mark
        const qualifies = s => recognized[s.user_id] || (s.viewer_count >= MIN_VIEWERS && (!LANGUAGES.length || LANGUAGES.includes(s.language)))
        const fresh = (preview ? live.slice(0, 1) : live.filter(s => qualifies(s) && !seen.announced[s.user_id]))
            .sort((a, b) => !!recognized[b.user_id] - !!recognized[a.user_id])  // recognized first, then by viewers
            .slice(0, MAX_PER_CHECK)
        for (const s of live.filter(qualifies)) seen.announced[s.user_id] ??= now
        if (!fresh.length) return []

        const users = Object.fromEntries((await helix(`users?${fresh.map(s => `id=${s.user_id}`).join('&')}`)).map(u => [u.id, u]))
        return fresh.map(s => streamCard(s, users[s.user_id], !!recognized[s.user_id]))
    },
}
module.exports.helix = helix  // for the community clips feed
module.exports.GAME = GAME
module.exports.LANGUAGES = LANGUAGES
