// Arcade runs posted as videos: in REPLAY_CHANNEL_ID (#holo-replays; TEST_CHANNEL_ID while testing), a YouTube link
// whose title names one arcade event and a time ("Landspeeder Ace - 1:09.13", "01:13.59 - Ramjet Run") is saved as
// the poster's time with the video as proof (src/submit.js, so a repeat only adds the proof), and the post gets a
// stopwatch reaction. Anything else (campaign runs, chat, a title naming no event or two) is left alone. Needs the
// GuildMessages and Message Content (privileged) intents.
const { testing } = require('../config.js')
const { replay_channel, test_channel } = require('./data/discord/channel.js')
const data = require('./swgr/data.js')
const emoji = require('./data/discord/emoji.js')
const { submit, formatTime } = require('./submit.js')
const records = require('./records.js')

const VIDEO = /(?:youtube\.com\/(?:watch\?(?:\S*?&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/g
// Lowercase words separated by single spaces, padded so names only match whole words
const words = s => ` ${s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()} `
const EVENTS = data.events.map(e => ({ event: e, key: words(e.name) })).sort((a, b) => b.key.length - a.key.length)

// A video title -> { event, seconds } or null. Exactly one event name (longest names first, each match taken out so
// a shorter name inside it doesn't count again) and a time that's plausible for it: between 60% of gold and 1.5x
// bronze, which keeps out other games' tracks that share a name.
exports.matchTitle = title => {
    let rest = words(title)
    const found = []
    for (const { event, key } of EVENTS) {
        if (rest.includes(key)) { found.push(event); rest = rest.replace(key, ' ') }
    }
    if (found.length != 1) return null
    const event = found[0]
    // "1:09.13", "01:13.59", "55.10"; "3:54:88" (hundredths after a colon) is read as 3:54.88
    const m = title.match(/(?<![\d:.])(?:\d{1,2}:)?\d{1,2}[.:]\d{2}(?![\d:.])/)
    if (!m) return null
    const seconds = records.parseTime(m[0].replace(/^(\d{1,2}:\d{2}):(\d{2})$/, '$1.$2'))
    if (seconds == null || seconds < event.medals.gold.seconds * 0.6 || seconds > event.medals.bronze.seconds * 1.5) return null
    return { event, seconds }
}

async function videoTitle(id) {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`)
    return res.ok ? (await res.json()).title : null
}

// Saves every matching run in a message; returns what happened to each, for logs and the backfill
exports.handle = async message => {
    if (message.author.bot || message.channelId != (testing ? test_channel : replay_channel)) return []
    const results = []
    for (const id of new Set([...message.content.matchAll(VIDEO)].map(m => m[1]))) {
        const title = await videoTitle(id).catch(() => null)
        const match = title && exports.matchTitle(title)
        if (!match) { results.push({ id, title, skipped: true }); continue }
        const result = await submit({ kind: 'arcade', target: match.event.id, member: message.member, memberId: message.author.id,
            time: formatTime(match.seconds), proof: `https://youtu.be/${id}` })
        results.push({ id, title, event: match.event.name, time: formatTime(match.seconds), ...result })
        if (!result.error) await message.react(emoji.named('stopwatch').replace(/^<a?:|>$/g, '')).catch(() => { })
    }
    for (const r of results) console.log(`[replays] ${message.author.username}: "${r.title}" -> ${r.skipped ? 'skipped' : r.error ?? r.message}`)
    return results
}
