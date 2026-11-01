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
//                  one best time; a multiplayer Tour Completed screen by its player row (the person icon), saved on
//                  that tour's final-race board (which tour: tourOf). Credited to the poster, or to the one person a
//                  submitter mentions. Proof is the post.
// Forwarded messages count too: their links and images are read from the forwarded copy, and the original message
// is looked up for its author and time. Anything else (campaign runs, chat, a title naming no event or two) is left
// alone. Needs the GuildMessages and Message Content (privileged) intents.
const { SnowflakeUtil, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const { testing } = require('../config.js')
const { replay_channels, test_channel } = require('./data/discord/channel.js')
const data = require('./swgr/data.js')
const emoji = require('./data/discord/emoji.js')
const { submit, formatTime, board: boardOf } = require('./submit.js')
const pages = require('./swgr/pages.js')
const records = require('./records.js')

const VIDEO = /(?:youtube\.com\/(?:watch\?(?:\S*?&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/g
// A Twitch video (a past broadcast or highlight): its id
const TWITCH = /twitch\.tv\/(?:\w+\/)?videos\/(\d+)/g
const VISION_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini'
// Lowercase words separated by single spaces, padded so names only match whole words
// (apostrophes dropped, so "Scrappers Run" matches "Scrapper's Run")
// and short forms people use spelled out ("speeder bike champ")
const SHORT = { champ: 'champion', champs: 'champion' }
// Accents are dropped and any script's letters kept, so translated titles compare the same way ("Ás" = "as")
const words = s => ` ${s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').map(w => SHORT[w] ?? w).join(' ')} `
// Times spelled with units or spaces, as the game's m:ss.hh: "1m 43s 35", "1m43s35", "1m 43.35s", "1 02 32" -> "1:43.35"
// (a spaced one only as three separate numbers; either way the time still has to be plausible for the event)
const unitTimes = s => s.replace(/\b(\d{1,2})\s*m(?:in)?\s*(\d{1,2})(?:\s*s(?:ec)?\s*|\s*[.,]\s*)(\d{2})(?:\s*s(?:ec)?)?\b/gi, '$1:$2.$3')
    .replace(/(?<![\d:.,])\b(\d{1,2}) ([0-5]\d) (\d{2})\b(?![\d:.,])/g, '$1:$2.$3')
// Chinese, Japanese and Korean titles often run words (and the time) together, so their names match anywhere
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
// Every event under its English name and the game's translations (event.names, from tools/import_swgr.py), longest
// first; a name shared by two events in any language (none today) is left out rather than risk the wrong board
const EVENTS = (() => {
    const owners = new Map()
    for (const e of data.events) for (const name of [e.name, ...Object.values(e.names ?? {})]) {
        const key = words(name)
        if (key.trim()) owners.set(key, (owners.get(key) ?? new Set()).add(e))
    }
    return [...owners].filter(([, events]) => events.size == 1)
        .map(([key, events]) => ({ event: [...events][0], key: UNSPACED.test(key) ? key.trim() : key }))
        .sort((a, b) => b.key.length - a.key.length)
})()
// An event's medal times as the results screen shows them, bronze to gold: "3:01 2:22 2:14"
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
// keyed by the three medal times fastest first, so the order a screen lists them in doesn't matter (results screens go
// bronze to gold, event cards gold to bronze)
const medalKey = seconds => [...seconds].sort((a, b) => a - b).map(mmss).join(' ')
const MEDALS = new Map(data.events.map(e => [medalKey(['bronze', 'silver', 'gold'].map(m => e.medals[m].seconds)), e]))
const readMedals = times => medalKey(times.map(t => readTime(t.includes('.') ? t : `${t}.00`) ?? -1))

// A time is plausible for an event between half of gold (skips: Cavern Drift has a 26.71 on a 45s gold) and 1.5x bronze, which keeps out other games' tracks that
// share a name and misreads
const plausible = (event, seconds) => seconds != null && seconds >= event.medals.gold.seconds * 0.5 && seconds <= event.medals.bronze.seconds * 1.5
// "01:13.59" -> 73.59; "3:54:88" (hundredths after a colon) is read as 3:54.88
const readTime = s => records.parseTime(String(s ?? '').trim().replace(/(\d),(\d{2})$/, '$1.$2').replace(/^(\d{1,2}:\d{2}):(\d{2})$/, '$1.$2'))  // "04:15,01" in French

// A video title -> { event, seconds } or null. Exactly one event name (longest names first, each match taken out so
// a shorter name inside it doesn't count again) and a plausible time.
exports.matchTitle = (title, { anyTime = false } = {}) => {
    title = unitTimes(title)
    let rest = words(title)
    const found = []
    for (const { event, key } of EVENTS) {
        if (rest.includes(key)) { if (!found.includes(event)) found.push(event); rest = rest.replace(key, ' ') }
    }
    if (found.length != 1) return null
    // the first time-shaped number that's plausible for the event (a date or a "top 10 20 30" isn't)
    const candidates = [...title.matchAll(/(?<![\d:.])(?:\d{1,2}:)?\d{1,2}[.:]\d{2}(?![\d:.])/g)].map(m => readTime(m[0]))
    const seconds = candidates.find(s => plausible(found[0], s)) ?? candidates[0] ?? null
    return anyTime || plausible(found[0], seconds) ? { event: found[0], seconds } : null
}

// A video title with a tour's final race: it names a tour ("Multiplayer Tour", "pod tour"), or the place the final is
// raced (Derven Acos or The Galactic Gauntlet for the Multiplayer Tour, Mos Espa for the Podracing Tour) and no arcade
// event, with a time a final takes. Arcade events on Derven Acos are all under 3:01 even at bronze and the tour's
// final takes 3:30 and up, so that planet's or track's name with a time from 3:10 is the tour's. A title naming one of
// the tour's earlier tracks is that race's ("1:12.53 Rhodochrosite Run Multiplayer Tour"), not the final. -> { tour, seconds }
const FINAL_PLACES = [['multiplayer-tour', /der?ven\s*acos|galactic\s*gauntlet/i, 190], ['podracing-tour', /mos\s*espa/i, 60]]  // "Deven Acos" happens
const earlierTrack = (tour, title) => tour.stops.some(stop => stop.tracks.some(id => id != tour.final.track && words(title).includes(words(data.track(id).name))))
exports.matchTourTitle = title => {
    title = unitTimes(title)
    const named = TOUR_NAMES.filter(([, re]) => re.test(title))
    const placed = FINAL_PLACES.filter(([, re]) => re.test(title))
    const [id, min] = named.length == 1 ? [named[0][0], 60] : !named.length && placed.length == 1 ? [placed[0][0], placed[0][2]] : []
    if (!id || earlierTrack(data.tour(id), title)) return null
    const seconds = [...title.matchAll(/(?<![\d:.])(?:\d{1,2}:)?\d{1,2}[.:]\d{2}(?![\d:.])/g)].map(m => readTime(m[0])).find(s => s >= min && s <= 900)
    return seconds ? { tour: data.tour(id), seconds } : null
}
// A posted or uploaded video's run: an arcade event's (matchTitle), else a tour final's (matchTourTitle)
exports.matchVideoTitle = title => exports.matchTitle(title) ?? exports.matchTourTitle(title)

// A Twitch video's { title, created (ms) }, by the Helix API (TWITCH_ID / TWITCH_SECRET); null without them
async function twitchVideo(id) {
    if (!process.env.TWITCH_ID || !process.env.TWITCH_SECRET) return null
    const v = (await require('./feeds/twitch.js').helix(`videos?id=${id}`))?.[0]
    return v ? { title: v.title, created: Date.parse(v.created_at) || Infinity } : null
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

// What a screenshot shows, read by the vision model: { screen, event_name, success_time, medal_times, vehicle, rows }
const SCREEN = {
    type: 'object', additionalProperties: false,
    required: ['screen', 'event_name', 'success_time', 'medal_times', 'vehicle', 'rows'],
    properties: {
        screen: { type: 'string', enum: ['arcade_results', 'arcade_event_card', 'tour_completed', 'race_standings', 'tour_summary', 'other'] },
        vehicle: { type: ['string', 'null'], description: 'tour_summary only: the vehicle class named at the top of the BUILD panel (e.g. PODRACER, SPEEDER BIKE)' },
        event_name: { type: ['string', 'null'], description: 'The arcade event name if printed on screen' },
        success_time: { type: ['string', 'null'], description: 'The large time under SUCCESS, exactly as shown' },
        medal_times: { type: 'array', items: { type: 'string' }, description: 'Medal target times left to right, exactly as shown' },
        rows: {
            type: 'array', description: 'Leaderboard / best-time rows: player name and time exactly as shown',
            items: { type: 'object', additionalProperties: false, required: ['rank', 'name', 'time', 'is_player'], properties: {
                rank: { type: ['integer', 'null'] }, name: { type: 'string' }, time: { type: 'string' },
                is_player: { type: 'boolean', description: 'tour_completed and race_standings only: the row with the person silhouette left of its place number (not a platform logo by the name)' },
            } },
        },
    },
}
const SCREEN_PROMPT = `You read screenshots of the racing game STAR WARS Galactic Racer. Transcribe exactly what is on screen; never guess. Use null or empty lists for anything not visible. The game may be in another language (French, Spanish, German...): recognise the screens by their layout, and copy times as shown, decimal commas included.
Screens to recognise:
- arcade_results: a panel titled ARCADE with SUCCESS and a large time, three medal times with rival names under it, and a RANK / NAME / TIME table. Give every table row.
- arcade_event_card: an arcade event's card with its name (often after the planet, e.g. "SENTINEL I ACID RINGER"), a START EVENT button, and a BEST TIMES or FRIEND TIMES panel listing player names with times. Give every time in that panel as a row, with the player name printed next to or under it.
- tour_completed: a multiplayer tour's end screen titled TOUR COMPLETED (or its translation: TOURNOI TERMINÉ, RECORRIDO COMPLETADO...), with three characters on a podium and a column of standings down the right: each row a place number with a time under it, then a banner with the racer's name, points and their form. Give every row: rank (the place number), name (on the banner), time (the time under the place number), and is_player true for the one row whose place number has a small person silhouette (a head and shoulders) printed just left of the digit, in the left column above that row's time; exactly one row has it. The monitor and PlayStation / Xbox logos after names are platform icons, not this marker, and a row drawn with a white outline is only the camera's selection: neither makes is_player true.
- race_standings: the same standings column as tour_completed (place numbers with times under them, name banners with points and five form boxes ending in a flag) but without the TOUR COMPLETED title in view: a cropped screenshot, a photo of a screen, or the column shown over the race view after finishing (with Previous / Next Position buttons; only finished racers have times). Give the rows the same way, is_player included.
- tour_summary: a tour's summary page with a LAST RACE RESULT panel (a place and a time), a FINAL BET RESULT panel, a TIMELINE of planets and a BUILD panel down the left. An image can stack several of these pages; give one row per LAST RACE RESULT panel: rank its place, name "", time as shown, is_player true.
- other: anything else, including races against rivals in the campaign.`
async function readScreen(url) {
    // Sent as data rather than a link: OpenAI fetching a large Discord file can time out
    const image = await fetch(url)
    if (!image.ok) throw new Error(`image: ${image.status}`)
    url = `data:${image.headers.get('content-type') || 'image/png'};base64,${Buffer.from(await image.arrayBuffer()).toString('base64')}`
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: VISION_MODEL,
            messages: [
                { role: 'system', content: SCREEN_PROMPT },
                { role: 'user', content: [{ type: 'image_url', image_url: { url, detail: 'high' } }] },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'screen', strict: true, schema: SCREEN } },
        }),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(`OpenAI: ${body.error?.message ?? res.status}`)
    return JSON.parse(body.choices[0].message.content)
}

// The row for a racer when a screen lists several (friend times): the one whose name matches one of theirs, else the
// only one containing one of them or contained in one ("TheSpacedCowboy" for SpacedCowboy; 5+ letters), else the only
// one a letter off (the model reads "Pollito" as "Polito" now and then; 5+ letters)
const words1 = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const oneOff = (a, b) => {  // the same but for one letter added, dropped or changed
    if (Math.abs(a.length - b.length) > 1 || a == b) return a == b
    let i = 0
    while (i < a.length && a[i] == b[i]) i++
    return [a.slice(i + 1) == b.slice(i + 1), a.slice(i + 1) == b.slice(i), a.slice(i) == b.slice(i + 1)].some(Boolean)
}
const rowFor = (rows, names) => {
    if (rows.length == 1) return rows[0]
    const keys = names.filter(Boolean).map(words1)
    const exact = rows.find(r => keys.includes(words1(r.name)))
    if (exact) return exact
    const near = rows.filter(r => (n => keys.some(k => Math.min(k.length, n.length) >= 5 && (n.includes(k) || k.includes(n))))(words1(r.name)))
    if (near.length == 1) return near[0]
    const typo = rows.filter(r => (n => keys.some(k => Math.min(k.length, n.length) >= 5 && oneOff(k, n)))(words1(r.name)))
    return typo.length == 1 ? typo[0] : undefined
}

// Which tour a Tour Completed screen ends: more than 8 racers is the Multiplayer Tour (a grid of 12 speeders; the
// Podracing Tour's is 8 pods). Otherwise (a cropped photo) the AI racers on it are characters who race one tour or the
// other (their styles' modes; "Dud Bolt 2" is Dud Bolt), so the tour most of them race; with no AI racers either, a
// final under three minutes is the Podracing Tour's Mos Espa Speedway, else the Multiplayer Tour's Galactic Gauntlet
const TOUR_OF = new Map(data.racers.map(r => {
    const modes = new Set(r.styles.flatMap(s => s.modes ?? []))
    const tours = data.tours.filter(t => modes.has(t.name))
    return [words1(r.name), tours.length == 1 ? tours[0] : null]
}))
const tourOf = (rows, seconds) => {
    if (rows.length > 8) return data.tour('multiplayer-tour')
    const votes = new Map()
    for (const r of rows) { const t = TOUR_OF.get(words1(r.name.replace(/\s+\d+$/, ''))); if (t) votes.set(t, (votes.get(t) ?? 0) + 1) }
    const [top] = [...votes].sort((a, b) => b[1] - a[1])
    return top?.[0] ?? data.tour(seconds < 180 ? 'podracing-tour' : 'multiplayer-tour')
}

// A read screen -> { event, seconds, title } (an arcade event) or { tour, seconds, title } (a tour's final race) or
// null. names: the racer's Discord names, to pick their row. text: the post's own words; the standings column without
// the TOUR COMPLETED title (a crop, a photo, the view after the finish) counts with more than 8 racers (a speeder
// tour's 12) or when they say it's from a tour (Quick Race and Quick Podrace end on the same column), and a tour they
// name ("multiplayer tour") is the one.
const TOURISH = /\btour\b|multi\s*player|\bmp\b|gauntlet|der?ven\s*acos|mos\s*espa/i
exports.matchScreen = (s, names = [], text = '') => {
    const said = TOUR_NAMES.filter(([, re]) => re.test(text)).map(([id]) => data.tour(id))
    const final = seconds => seconds >= 60 && seconds <= 900  // a final race takes a minute to 15
    // The summary page: its LAST RACE RESULT time (the fastest, when an image stacks several); the build panel says
    // which tour (a podracer, else speeders)
    if (s.screen == 'tour_summary') {
        const seconds = Math.min(...s.rows.map(r => readTime(r.time)).filter(final))
        if (seconds == Infinity) return null
        const tour = said.length == 1 ? said[0] : s.vehicle ? data.tour(/pod/i.test(s.vehicle) ? 'podracing-tour' : 'multiplayer-tour') : tourOf([], seconds)
        return { tour, seconds, title: 'tour summary' }
    }
    if ((s.screen == 'tour_completed' || (s.screen == 'race_standings' && (s.rows.length > 8 || TOURISH.test(text)))) && s.rows.length) {
        // The racer's row by their Discord name, else the one with the person icon (the model misses or misplaces that
        // marker more often, and a read that flags several rows has misread it); a time for the final race (a minute
        // to 15)
        const flagged = s.rows.filter(r => r.is_player)
        const named = s.rows.length > 1 ? rowFor(s.rows, names) : null
        const row = named ?? (flagged.length == 1 ? flagged[0] : null)
        const seconds = readTime(row?.time)
        if (!final(seconds)) return null
        // gamertag: the in-game name of a row found by its icon, to remember for the racer (records.addGamertag)
        return { tour: said.length == 1 ? said[0] : tourOf(s.rows, seconds), seconds, title: 'tour results', gamertag: named ? null : row.name }
    }
    if (s.screen == 'arcade_results') {
        const event = MEDALS.get(readMedals(s.medal_times))
        if (!event) return null
        // The leaderboard row for this run: the one within a hundredth or two of the SUCCESS time, else the only one
        const success = readTime(s.success_time)
        const row = s.rows.map(r => readTime(r.time)).find(t => t != null && success != null && Math.abs(t - success) <= 0.021)
        const seconds = row ?? (s.rows.length ? readTime(rowFor(s.rows, names)?.time) : success)
        return plausible(event, seconds) ? { event, seconds, title: `results screen` } : null
    }
    if (s.screen == 'arcade_event_card' && s.event_name && s.rows.length) {
        // The medal times identify the event when the card shows them (the model can misread the name, e.g. as the
        // planet's other event); the name is the fallback
        const event = MEDALS.get(readMedals(s.medal_times))
            ?? exports.matchTitle(`${s.event_name} 0:00.00`, { anyTime: true })?.event
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
        // When the original was posted: its id encodes it, even when the bot can't open it
        posted: original?.createdTimestamp ?? (ref?.messageId ? SnowflakeUtil.timestampFrom(ref.messageId) : message.createdTimestamp),
        content: snapshot.content ?? '',
        attachments: [...(snapshot.attachments?.values() ?? [])],
        forward: true,
    }
}

exports.videos = videos
exports.readScreen = readScreen
exports.VIDEO = VIDEO

// Whether a message mentions the bot ("@Autopilot"): the bot's own mention, or its role's (Discord offers both in the
// picker). Replying to the bot isn't a mention of it here.
exports.mentionsMe = message => {
    const role = message.guild?.members.me?.roles.botRole?.id
    return new RegExp(`<@!?${message.client.user.id}>${role ? `|<@&${role}>` : ''}`).test(message.content)
}

// Whether the author mentions the bot right after a message (within a few seconds): the mention handles that message
async function mentionFollows(message, wait = 4000) {
    await new Promise(r => setTimeout(r, wait))
    const after = await message.channel.messages.fetch({ after: message.id, limit: 5 }).catch(() => null)
    return [...(after?.values() ?? [])].some(m => m.author.id == message.author.id && m.createdTimestamp - message.createdTimestamp < 10000
        && exports.mentionsMe(m))
}

// Takes back the bot's "?" (whose run?) from a message, once a mention has named the racer
const unmarkUnknown = message => message.reactions.cache.find(r => r.me && (r.emoji.name == 'unknown' || r.emoji.name == '❓'))?.users.remove(message.client.user.id).catch(() => { })

// The reaction that confirms saved runs: the run's emoji as the event menus would show it (its place once it's gold
// and top 10, else its medal, else the tick; pages.standingEmoji), for the best of them when there are several; the
// stopwatch for a staff time
const STANDING = ['gold', 'silver', 'bronze']
function confirm(message, saved) {
    const runs = saved.map(r => ({ e: data.event(r.target), ...r })).filter(r => r.e && r.place)
        .map(r => ({ ...r, medal: (i => i < 0 ? 3 : i)(STANDING.findIndex(m => r.seconds <= r.e.medals[m].seconds)) }))
    const best = runs.sort((a, b) => a.medal - b.medal || a.place - b.place)[0]
    const shown = best ? pages.standingEmoji(best.e, best.seconds, best.place) : emoji.named('stopwatch')
    return message.react(shown.replace(/^<a?:|>$/g, '')).catch(() => { })
}

// A "View board" button per board the saved runs are on (as on podium announcements), for the mention's reply
const viewButtons = saved => {
    const boards = [...new Set(saved.map(r => `${r.kind}:${r.target}`))].slice(0, 5).map(b => b.split(':'))
    return boards.length ? [new ActionRowBuilder().addComponents(boards.map(([kind, target]) => new ButtonBuilder()
        .setCustomId(records.boardView(kind, target))
        .setLabel(boards.length > 1 ? `View ${(boardOf(kind, target)?.name ?? 'board').slice(0, 70)}` : 'View board')
        .setStyle(ButtonStyle.Secondary)))] : []
}

// Saves every run found in a message; returns what happened to each, for logs and backfills
// announce: false for backfills of old posts, so they don't announce podium changes. anywhere: a message outside the
// replay channel that someone asked for (a ⏱️ reaction or an @Autopilot mention, bot.js). racer: the user an
// @Autopilot mention names, who gets every run found (over a video channel's owner too)
exports.handle = async (message, { announce = true, anywhere = false, racer: chosen = null } = {}) => {
    if (message.author.bot || (!anywhere && !(testing ? [test_channel] : replay_channels).includes(message.channelId))) return []
    const src = await source(message)
    // A forward whose author the bot can't see is usually followed by "@Autopilot @racer" a moment later, which reads
    // it with the racer named; read on its own, it would only get a "?" (whose run?) beside that save. So wait a few
    // seconds and leave it to the mention if one comes.
    if (!anywhere && src.forward && !src.author && await mentionFollows(message)) return []
    const results = []
    const save = async (match, { racer, date, proof, youtube, label, proofType }) => {
        // an arcade event, or a tour's final race (a Tour Completed screen)
        const [kind, item] = match.tour ? ['tour', match.tour] : ['arcade', match.event]
        const result = await submit({
            kind, target: item.id, member: message.member, memberId: message.author.id, racer, trusted: true,
            time: formatTime(match.seconds), proof, date, youtube, announce, proofType,
        })
        results.push({ label, event: item.name, time: formatTime(match.seconds), racer: racer.id, ...result })
    }

    // The one person a submitter's message mentions names the racer: for a screenshot, and for a forward whose author
    // the bot can't see (Discord doesn't say who wrote a forwarded message, and the original may be in a server the
    // bot isn't in)
    const mentioned = [...message.mentions.users.values()].filter(u => !u.bot)
    const named = chosen ?? (mentioned.length == 1 && records.canSubmitForOthers(message.member) ? mentioned[0] : null)
    let unclaimed = 0  // runs found without a racer to credit (answered with the game's "?" marker)

    // Videos: credited to the channel's owner; an unlinked channel is linked to the racer named, else the original poster
    const ids = [...new Set([...src.content.matchAll(VIDEO)].map(m => m[1]))]
    const info = await videos(ids)
    for (const id of ids) {
        const v = info[id]
        const match = v?.title && exports.matchVideoTitle(v.title)
        if (!match) { results.push({ label: v?.title ?? id, skipped: true }); continue }
        let owner = chosen?.id ?? (v.channelId && records.youtubeOwner(v.channelId))
        const claimant = named ?? (src.author && !src.author.bot ? src.author : null)
        if (!owner && claimant) {
            owner = claimant.id
            if (v.channelId) await records.linkYoutube(v.channelId, { user: owner, name: v.channelName, by: message.author.id })
        }
        if (!owner) { unclaimed++; results.push({ label: v.title, skipped: true, why: "can't tell whose run it is" }); continue }
        await save(match, { racer: { id: owner, bot: false }, date: Math.min(v.uploaded ?? Infinity, src.posted), proof: `https://youtu.be/${id}`, youtube: v.channelId, label: v.title })
    }

    // Twitch videos: their titles read like YouTube ones; credited to the racer named, else the poster (Twitch channels
    // aren't linked to racers)
    for (const id of new Set([...src.content.matchAll(TWITCH)].map(m => m[1]))) {
        const v = await twitchVideo(id).catch(() => null)
        const match = v?.title && exports.matchVideoTitle(v.title)
        if (!match) { results.push({ label: v?.title ?? `twitch.tv/videos/${id}`, skipped: true }); continue }
        const owner = chosen ?? named ?? (src.author && !src.author.bot ? src.author : null)
        if (!owner) { unclaimed++; results.push({ label: v.title, skipped: true, why: "can't tell whose run it is" }); continue }
        await save(match, { racer: owner, date: Math.min(v.created, src.posted), proof: `https://www.twitch.tv/videos/${id}`, proofType: 'video', label: v.title })
    }

    // Screenshots: credited to the poster, or to the one person a submitter mentions
    const images = src.attachments.filter(a => a.contentType?.startsWith('image/'))
    if (images.length && process.env.OPENAI_API_KEY) {
        const racer = named ?? src.author
        for (const image of images) {
            // The model now and then misses a row on an arcade screen; one more read usually gets it
            const names = racer ? [racer.username, racer.globalName, racer.id == src.author?.id ? src.member?.displayName : null, ...records.gamertagsOf(racer.id)] : []
            let screen = await readScreen(image.url).catch(error => ({ error }))
            let match = !screen.error && exports.matchScreen(screen, names, src.content)
            if (!match && (screen.error || /^(arcade|tour|race)/.test(screen.screen ?? ''))) {  // one more try after an error too
                screen = await readScreen(image.url).catch(error => ({ error }))
                match = !screen.error && exports.matchScreen(screen, names, src.content)
            }
            if (match && (!racer || racer.bot)) { unclaimed++; results.push({ label: image.name, skipped: true, why: "a run, but whose? (forward without a mention)" }); continue }
            if (!match) { results.push({ label: image.name, skipped: true, why: screen.error?.message ?? screen.screen }); continue }
            await save(match, { racer, date: src.posted, proof: image.url, proofType: 'screenshot', label: `${image.name} (${match.title})` })
            if (match.gamertag) await records.addGamertag(racer.id, match.gamertag).catch(error => console.error('[replays] gamertag', error))
        }
    }

    // A video file attached, with the event and time written in the post ("Speeder Bike Ace 1:20.39"): the video file is
    // the proof (its CDN link, which opens the video itself). Credited like a screenshot.
    const clips = src.attachments.filter(a => a.contentType?.startsWith('video/'))
    const claim = clips.length && exports.matchClaim(src.content.replace(/<@[!&]?\d+>/g, ' ').replace(/https?:\/\/\S+/g, ' '))
    if (claim) {
        const racer = named ?? src.author
        if (!racer || racer.bot) { unclaimed++; results.push({ label: clips[0].name, skipped: true, why: 'a run, but whose? (forward without a mention)' }) }
        else await save(claim, { racer, date: src.posted, proof: clips[0].url, proofType: 'video', label: `${clips[0].name} ("${src.content.slice(0, 60)}")` })
    }

    const saved = results.filter(r => !r.skipped && !r.error)
    if (saved.length) await confirm(message, saved)
    else if (unclaimed) await message.react(emoji.named('unknown').replace(/^<a?:|>$/g, '') || '❓').catch(() => { })  // the game's "?" marker
    for (const r of results) console.log(`[replays] ${message.author.username}${src.forward ? ' (forward)' : ''}: "${r.label}" -> ${r.skipped ? `skipped${r.why ? ` (${r.why})` : ''}` : r.error ?? `${r.message}`}`)
    return results
}

// A typed claim: one event name and a time in any form /submit takes ("1:13.59", "10892", "55.1", "1:10:00"), the
// first number that reads as a plausible time for that event
exports.matchClaim = text => {
    text = unitTimes(text)
    const event = exports.matchTitle(`${text} 0:00.00`, { anyTime: true })?.event
    if (!event) return null
    for (const token of text.match(/\d[\d:.]*\d|\d/g) ?? []) {
        const seconds = readTime(token)
        if (plausible(event, seconds)) return { event, seconds }
    }
    return null
}

// A typed multiplayer tour time: the tour's name ("Multiplayer Tour", "Podracing Tour", or "MP" / "pod" tour, a word or
// two between allowed: "multiplayer standard tour") and a time
// for its final race (a minute to 15)
const TOUR_NAMES = [['multiplayer-tour', /\b(multiplayer|mp)(\s+\w+){0,2}?\s+tour\b/i], ['podracing-tour', /\bpod(racing|race|racer)?(\s+\w+){0,2}?\s+tour\b/i]]
exports.matchTour = text => {
    text = unitTimes(text)
    const found = TOUR_NAMES.filter(([, re]) => re.test(text)).map(([id]) => data.tour(id)).filter(Boolean)
    if (found.length != 1) return null
    for (const token of text.match(/\d[\d:.]*\d|\d/g) ?? []) {
        const seconds = readTime(token)
        if (seconds >= 60 && seconds <= 900) return { tour: found[0], seconds }
    }
    return null
}

// "@Autopilot [@racer] [event time]" anywhere (bot.js): submits a run on the spot. The racer is the one other person
// mentioned (people who can submit for others only), else the author. An event and a time in the text are saved as
// given, with the message's video link or attached file (else the message itself) as proof; otherwise the attached screenshot or YouTube link (a
// forward's too) is read as above. Answers with a short reply, without pinging anyone.
exports.handleMention = async message => {
    const me = message.client.user
    // Mentions from the text itself: Discord only lists mentioned users who are members of the server, and a racer from
    // elsewhere (a forward from the official server) is mentioned by id
    const ids = [...new Set([...message.content.matchAll(/<@!?(\d+)>/g)].map(m => m[1]))].filter(id => id != me.id)
    const others = (await Promise.all(ids.map(id => message.mentions.users.get(id) ?? message.client.users.fetch(id).catch(() => null))))
        .filter(u => u && !u.bot)
    const reply = (content, components = []) => message.reply({ content, components, allowedMentions: { parse: [], repliedUser: false }, flags: MessageFlags.SuppressNotifications }).catch(() => { })
    if (others.length > 1) return reply('Mention one racer at a time.')
    const racer = others[0] ?? message.author
    if (racer.id != message.author.id && !records.canSubmitForOthers(message.member)) return reply("You can only submit your own times. Leave out the mention to submit yours.")

    // What the run is in: this message, or, when it has nothing of its own, the author's message just before it (sent
    // within a few seconds): a forward's added message arrives as a separate message right after the forward
    const src = await source(message)
    const hasOwn = message.attachments.size || message.messageSnapshots?.size || VIDEO.test(message.content)
    VIDEO.lastIndex = 0  // the pattern is global
    let target = message
    if (!hasOwn) {
        const earlier = await message.channel.messages.fetch({ before: message.id, limit: 3 }).catch(() => null)
        const prev = [...(earlier?.values() ?? [])].find(m => m.author.id == message.author.id)
        if (prev && message.createdTimestamp - prev.createdTimestamp < 10000) target = prev
    }
    const tsrc = target == message ? src : await source(target)

    // An event and time written out: "@Autopilot Ramjet Run 1:13.59". The proof is a video in the message (or the one
    // it goes with), else the message holding the screenshot, else the claim itself.
    const text = message.content.replace(/<@[!&]?\d+>/g, ' ').replace(/https?:\/\/\S+/g, ' ')  // no mentions or links (their digits aren't times)
    // a multiplayer tour's final ("@Autopilot Multiplayer Tour 3:56.09") first: its digits could read as an event's time
    const tour = exports.matchTour(text)
    const given = tour ?? exports.matchClaim(text)
    if (given) {
        const [kind, item] = tour ? ['tour', tour.tour] : ['arcade', given.event]
        const video = [...`${message.content} ${src.content} ${tsrc.content}`.matchAll(VIDEO)][0]?.[1]
        const shot = message.attachments.size || src.attachments.length ? message : tsrc.attachments.length ? target : null
        // an attached video file is video proof, like a YouTube link; a file's own link is the proof (the post's when
        // it's some other file)
        const files = [...message.attachments.values(), ...src.attachments, ...tsrc.attachments]
        const clip = files.find(a => a.contentType?.startsWith('video/')), image = files.find(a => a.contentType?.startsWith('image/'))
        const result = await submit({
            kind, target: item.id, member: message.member, memberId: message.author.id, racer, trusted: true,
            time: formatTime(given.seconds), proof: video ? `https://youtu.be/${video}` : (clip ?? image)?.url ?? (shot ?? message).url, date: tsrc.posted,
            proofType: video || clip ? 'video' : shot ? 'screenshot' : 'claim',
        })
        console.log(`[mention] ${message.author.username} for ${racer.username}: "${item.name} ${formatTime(given.seconds)}" -> ${result.error ?? result.message}`)
        if (!result.error) await confirm(message, [result])
        return reply(result.error ?? result.message, result.error ? [] : viewButtons([result]))
    }

    // Otherwise read what's attached
    const results = await exports.handle(target, { anywhere: true, racer })
    const saved = results.filter(r => !r.skipped && !r.error)
    if (saved.length && target != message) await unmarkUnknown(target)
    if (saved.length) return reply(saved.map(r => r.message).join('\n'), viewButtons(saved))
    if (results.some(r => r.error)) return reply(results.find(r => r.error).error)
    return reply(target != message || src.content || src.attachments.length
        ? "I couldn't find an arcade run or tour result in that. Add the event and time, like `@Autopilot Ramjet Run 1:13.59` (or `@Autopilot Multiplayer Tour 3:34.34`)."
        : 'Mention me with an event and a time (`@Autopilot Ramjet Run 1:13.59`), or with a screenshot or YouTube link of the run.')
}
