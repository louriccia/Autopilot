// Arcade runs posted in REPLAY_CHANNEL_ID (#holo-replays; TEST_CHANNEL_ID while testing), saved as times through
// src/submit.js (so a repeat only fills in what's new), with a stopwatch reaction on the post:
//   YouTube links  the title must name one arcade event and a time ("Landspeeder Ace - 1:09.13", "01:13.59 - Ramjet
//                  Run"). The run is credited to the video's channel owner (youtube/ in the database); a channel's
//                  first post links it to whoever posted it (the original author, for a forward), and /times youtube
//                  fixes a wrong link. Dated by the earlier of upload and post. Video details come from the YouTube
//                  Data API (YOUTUBE_API_KEY), or just the title from oEmbed without it.
//   Screenshots    read by an OpenAI vision model (OPENAI_API_KEY, OPENAI_MODEL): an arcade results screen is
//                  identified by its three medal times (unique per event) and records its leaderboard row's time (the
//                  game stores that, a hundredth off the big SUCCESS time at times); an event card by its name and its
//                  one best time. Credited to the poster, or to the one person a submitter mentions. Proof is the post.
// Forwarded messages count too: their links and images are read from the forwarded copy, and the original message
// is looked up for its author and time. Anything else (campaign runs, chat, a title naming no event or two) is left
// alone. Needs the GuildMessages and Message Content (privileged) intents.
const { testing } = require('../config.js')
const { replay_channel, test_channel } = require('./data/discord/channel.js')
const data = require('./swgr/data.js')
const emoji = require('./data/discord/emoji.js')
const { submit, formatTime } = require('./submit.js')
const records = require('./records.js')

const VIDEO = /(?:youtube\.com\/(?:watch\?(?:\S*?&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/g
const VISION_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini'
// Lowercase words separated by single spaces, padded so names only match whole words
const words = s => ` ${s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()} `
const EVENTS = data.events.map(e => ({ event: e, key: words(e.name) })).sort((a, b) => b.key.length - a.key.length)
// An event's medal times as the results screen shows them, bronze to gold: "3:01 2:22 2:14"
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const MEDALS = new Map(data.events.map(e => [['bronze', 'silver', 'gold'].map(m => mmss(e.medals[m].seconds)).join(' '), e]))

// A time is plausible for an event between 60% of gold and 1.5x bronze, which keeps out other games' tracks that
// share a name and misreads
const plausible = (event, seconds) => seconds != null && seconds >= event.medals.gold.seconds * 0.6 && seconds <= event.medals.bronze.seconds * 1.5
// "01:13.59" -> 73.59; "3:54:88" (hundredths after a colon) is read as 3:54.88
const readTime = s => records.parseTime(String(s ?? '').trim().replace(/^(\d{1,2}:\d{2}):(\d{2})$/, '$1.$2'))

// A video title -> { event, seconds } or null. Exactly one event name (longest names first, each match taken out so
// a shorter name inside it doesn't count again) and a plausible time.
exports.matchTitle = (title, { anyTime = false } = {}) => {
    let rest = words(title)
    const found = []
    for (const { event, key } of EVENTS) {
        if (rest.includes(key)) { found.push(event); rest = rest.replace(key, ' ') }
    }
    if (found.length != 1) return null
    const m = title.match(/(?<![\d:.])(?:\d{1,2}:)?\d{1,2}[.:]\d{2}(?![\d:.])/)
    const seconds = m && readTime(m[0])
    return anyTime || plausible(found[0], seconds) ? { event: found[0], seconds } : null
}

// Video id -> { title, channelId, channelName, uploaded (ms) }
async function videos(ids) {
    if (!ids.length) return {}
    if (process.env.YOUTUBE_API_KEY) {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${ids.join(',')}&key=${process.env.YOUTUBE_API_KEY}`)
        const body = await res.json()
        if (!res.ok) throw new Error(`YouTube API: ${body.error?.message ?? res.status}`)
        return Object.fromEntries(body.items.map(v => [v.id, { title: v.snippet.title, channelId: v.snippet.channelId, channelName: v.snippet.channelTitle, uploaded: Date.parse(v.snippet.publishedAt) }]))
    }
    const out = {}
    for (const id of ids) {
        const res = await fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${id}&format=json`).catch(() => null)
        if (res?.ok) out[id] = { title: (await res.json()).title }
    }
    return out
}

// What a screenshot shows, read by the vision model: { screen, event_name, success_time, medal_times, rows }
const SCREEN = {
    type: 'object', additionalProperties: false,
    required: ['screen', 'event_name', 'success_time', 'medal_times', 'rows'],
    properties: {
        screen: { type: 'string', enum: ['arcade_results', 'arcade_event_card', 'other'] },
        event_name: { type: ['string', 'null'], description: 'The arcade event name if printed on screen' },
        success_time: { type: ['string', 'null'], description: 'The large time under SUCCESS, exactly as shown' },
        medal_times: { type: 'array', items: { type: 'string' }, description: 'Medal target times left to right, exactly as shown' },
        rows: {
            type: 'array', description: 'Leaderboard / best-time rows: player name and time exactly as shown',
            items: { type: 'object', additionalProperties: false, required: ['rank', 'name', 'time'], properties: { rank: { type: ['integer', 'null'] }, name: { type: 'string' }, time: { type: 'string' } } },
        },
    },
}
const SCREEN_PROMPT = `You read screenshots of the racing game STAR WARS Galactic Racer. Transcribe exactly what is on screen; never guess. Use null or empty lists for anything not visible.
Screens to recognise:
- arcade_results: a panel titled ARCADE with SUCCESS and a large time, three medal times with rival names under it, and a RANK / NAME / TIME table. Give every table row.
- arcade_event_card: an arcade event's card with its name (often after the planet, e.g. "SENTINEL I ACID RINGER"), a START EVENT button, and a BEST TIMES or FRIEND TIMES panel listing player names with times. Give every time in that panel as a row, with the player name printed next to or under it.
- other: anything else, including races against rivals in the campaign.`
async function readScreen(url) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: VISION_MODEL,
            messages: [
                { role: 'system', content: SCREEN_PROMPT },
                { role: 'user', content: [{ type: 'image_url', image_url: { url } }] },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'screen', strict: true, schema: SCREEN } },
        }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(`OpenAI: ${body.error?.message ?? res.status}`)
    return JSON.parse(body.choices[0].message.content)
}

// The row for a racer when a screen lists several (friend times): the one whose name matches one of theirs
const words1 = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const rowFor = (rows, names) => rows.length == 1 ? rows[0] : rows.find(r => names.some(n => n && words1(n) == words1(r.name)))

// A read screen -> { event, seconds, title } or null. names: the racer's Discord names, to pick their row.
exports.matchScreen = (s, names = []) => {
    if (s.screen == 'arcade_results') {
        const event = MEDALS.get(s.medal_times.map(t => mmss(readTime(t.includes('.') ? t : `${t}.00`) ?? -1)).join(' '))
        if (!event) return null
        // The leaderboard row for this run: the one within a hundredth or two of the SUCCESS time, else the only one
        const success = readTime(s.success_time)
        const row = s.rows.map(r => readTime(r.time)).find(t => t != null && success != null && Math.abs(t - success) <= 0.021)
        const seconds = row ?? (s.rows.length ? readTime(rowFor(s.rows, names)?.time) : success)
        return plausible(event, seconds) ? { event, seconds, title: `results screen` } : null
    }
    if (s.screen == 'arcade_event_card' && s.event_name && s.rows.length) {
        const event = exports.matchTitle(`${s.event_name} 0:00.00`, { anyTime: true })?.event
        const seconds = readTime(rowFor(s.rows, names)?.time)
        return event && plausible(event, seconds) ? { event, seconds, title: `event card` } : null
    }
    return null
}

// The message as posted: for a forward, the forwarded copy's text and files, with the original's author and time
// when the original can be fetched
async function source(message) {
    const snapshot = message.messageSnapshots?.first()
    if (!snapshot) return { message, author: message.author, member: message.member, posted: message.createdTimestamp, content: message.content, attachments: [...message.attachments.values()], forward: false }
    const ref = message.reference
    const original = ref?.messageId && await message.client.channels.fetch(ref.channelId).then(c => c.messages.fetch(ref.messageId)).catch(() => null)
    return {
        message,
        author: original?.author ?? null,  // unknown when the original isn't visible to the bot
        member: original?.member ?? null,
        posted: original?.createdTimestamp ?? snapshot.createdTimestamp ?? message.createdTimestamp,
        content: snapshot.content ?? '',
        attachments: [...(snapshot.attachments?.values() ?? [])],
        forward: true,
    }
}

exports.videos = videos
exports.readScreen = readScreen
exports.VIDEO = VIDEO

// Saves every run found in a message; returns what happened to each, for logs and backfills
exports.handle = async message => {
    if (message.author.bot || message.channelId != (testing ? test_channel : replay_channel)) return []
    const src = await source(message)
    const results = []
    const save = async (match, { racer, date, proof, youtube, label }) => {
        const result = await submit({
            kind: 'arcade', target: match.event.id, member: message.member, memberId: message.author.id, racer, trusted: true,
            time: formatTime(match.seconds), proof, date, youtube,
        })
        results.push({ label, event: match.event.name, time: formatTime(match.seconds), racer: racer.id, ...result })
    }

    // Videos: credited to the channel's owner; an unlinked channel is linked to the original poster
    const ids = [...new Set([...src.content.matchAll(VIDEO)].map(m => m[1]))]
    const info = await videos(ids)
    for (const id of ids) {
        const v = info[id]
        const match = v?.title && exports.matchTitle(v.title)
        if (!match) { results.push({ label: v?.title ?? id, skipped: true }); continue }
        let owner = v.channelId && records.youtubeOwner(v.channelId)
        if (!owner && src.author && !src.author.bot) {
            owner = src.author.id
            if (v.channelId) await records.linkYoutube(v.channelId, { user: owner, name: v.channelName, by: message.author.id })
        }
        if (!owner) { results.push({ label: v.title, skipped: true, why: "can't tell whose run it is" }); continue }
        await save(match, { racer: { id: owner, bot: false }, date: Math.min(v.uploaded ?? Infinity, src.posted), proof: `https://youtu.be/${id}`, youtube: v.channelId, label: v.title })
    }

    // Screenshots: credited to the poster, or to the one person a submitter mentions
    const images = src.attachments.filter(a => a.contentType?.startsWith('image/'))
    if (images.length && process.env.OPENAI_API_KEY) {
        const mentioned = [...message.mentions.users.values()].filter(u => !u.bot)
        const racer = mentioned.length == 1 && records.canSubmitForOthers(message.member) ? mentioned[0] : src.author
        for (const image of images) {
            const screen = await readScreen(image.url).catch(error => ({ error }))
            const match = !screen.error && racer && exports.matchScreen(screen, [racer.username, racer.globalName, racer.id == src.author?.id ? src.member?.displayName : null])
            if (!match || !racer || racer.bot) { results.push({ label: image.name, skipped: true, why: screen.error?.message ?? screen.screen }); continue }
            await save(match, { racer, date: src.posted, proof: message.url, label: `${image.name} (${match.title})` })
        }
    }

    if (results.some(r => !r.skipped && !r.error)) await message.react(emoji.named('stopwatch').replace(/^<a?:|>$/g, '')).catch(() => { })
    for (const r of results) console.log(`[replays] ${message.author.username}${src.forward ? ' (forward)' : ''}: "${r.label}" -> ${r.skipped ? `skipped${r.why ? ` (${r.why})` : ''}` : r.error ?? `${r.message}`}`)
    return results
}
