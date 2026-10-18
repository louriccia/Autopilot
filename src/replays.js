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
const { SnowflakeUtil, MessageFlags } = require('discord.js')
const { testing } = require('../config.js')
const { replay_channels, test_channel } = require('./data/discord/channel.js')
const data = require('./swgr/data.js')
const emoji = require('./data/discord/emoji.js')
const { submit, formatTime } = require('./submit.js')
const records = require('./records.js')

const VIDEO = /(?:youtube\.com\/(?:watch\?(?:\S*?&)?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/g
const VISION_MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini'
// Lowercase words separated by single spaces, padded so names only match whole words
// (apostrophes dropped, so "Scrappers Run" matches "Scrapper's Run")
// and short forms people use spelled out ("speeder bike champ")
const SHORT = { champ: 'champion', champs: 'champion' }
// Accents are dropped and any script's letters kept, so translated titles compare the same way ("Ás" = "as")
const words = s => ` ${s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').map(w => SHORT[w] ?? w).join(' ')} `
// Times spelled with units, as the game's m:ss.hh: "1m 43s 35", "1m43s35", "1m 43.35s" -> "1:43.35"
const unitTimes = s => s.replace(/\b(\d{1,2})\s*m(?:in)?\s*(\d{1,2})(?:\s*s(?:ec)?\s*|\s*[.,]\s*)(\d{2})(?:\s*s(?:ec)?)?\b/gi, '$1:$2.$3')
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

// A time is plausible for an event between 60% of gold and 1.5x bronze, which keeps out other games' tracks that
// share a name and misreads
const plausible = (event, seconds) => seconds != null && seconds >= event.medals.gold.seconds * 0.6 && seconds <= event.medals.bronze.seconds * 1.5
// "01:13.59" -> 73.59; "3:54:88" (hundredths after a colon) is read as 3:54.88
const readTime = s => records.parseTime(String(s ?? '').trim().replace(/^(\d{1,2}:\d{2}):(\d{2})$/, '$1.$2'))

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
                { role: 'user', content: [{ type: 'image_url', image_url: { url, detail: 'high' } }] },
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

// The reaction that confirms saved runs: the game's crown when one of them is #1 on its board, else the stopwatch
const confirm = (message, saved) => message.react(emoji.named(saved.some(r => r.first) ? 'crown' : 'stopwatch').replace(/^<a?:|>$/g, '')).catch(() => { })

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
        const result = await submit({
            kind: 'arcade', target: match.event.id, member: message.member, memberId: message.author.id, racer, trusted: true,
            time: formatTime(match.seconds), proof, date, youtube, announce, proofType,
        })
        results.push({ label, event: match.event.name, time: formatTime(match.seconds), racer: racer.id, ...result })
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
        const match = v?.title && exports.matchTitle(v.title)
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

    // Screenshots: credited to the poster, or to the one person a submitter mentions
    const images = src.attachments.filter(a => a.contentType?.startsWith('image/'))
    if (images.length && process.env.OPENAI_API_KEY) {
        const racer = named ?? src.author
        for (const image of images) {
            // The model now and then misses a row on an arcade screen; one more read usually gets it
            const names = racer ? [racer.username, racer.globalName, racer.id == src.author?.id ? src.member?.displayName : null] : []
            let screen = await readScreen(image.url).catch(error => ({ error }))
            let match = !screen.error && exports.matchScreen(screen, names)
            if (!match && screen.screen?.startsWith('arcade')) {
                screen = await readScreen(image.url).catch(error => ({ error }))
                match = !screen.error && exports.matchScreen(screen, names)
            }
            if (match && (!racer || racer.bot)) { unclaimed++; results.push({ label: image.name, skipped: true, why: "a run, but whose? (forward without a mention)" }); continue }
            if (!match) { results.push({ label: image.name, skipped: true, why: screen.error?.message ?? screen.screen }); continue }
            await save(match, { racer, date: src.posted, proof: image.url, proofType: 'screenshot', label: `${image.name} (${match.title})` })
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
    const reply = content => message.reply({ content, allowedMentions: { parse: [], repliedUser: false }, flags: MessageFlags.SuppressNotifications }).catch(() => { })
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
    const given = exports.matchClaim(text)
    if (given) {
        const video = [...`${message.content} ${src.content} ${tsrc.content}`.matchAll(VIDEO)][0]?.[1]
        const shot = message.attachments.size || src.attachments.length ? message : tsrc.attachments.length ? target : null
        // an attached video file is video proof, like a YouTube link; a file's own link is the proof (the post's when
        // it's some other file)
        const files = [...message.attachments.values(), ...src.attachments, ...tsrc.attachments]
        const clip = files.find(a => a.contentType?.startsWith('video/')), image = files.find(a => a.contentType?.startsWith('image/'))
        const result = await submit({
            kind: 'arcade', target: given.event.id, member: message.member, memberId: message.author.id, racer, trusted: true,
            time: formatTime(given.seconds), proof: video ? `https://youtu.be/${video}` : (clip ?? image)?.url ?? (shot ?? message).url, date: tsrc.posted,
            proofType: video || clip ? 'video' : shot ? 'screenshot' : 'claim',
        })
        console.log(`[mention] ${message.author.username} for ${racer.username}: "${given.event.name} ${formatTime(given.seconds)}" -> ${result.error ?? result.message}`)
        if (!result.error) await confirm(message, [result])
        return reply(result.error ?? result.message)
    }

    // Otherwise read what's attached
    const results = await exports.handle(target, { anywhere: true, racer })
    const saved = results.filter(r => !r.skipped && !r.error)
    if (saved.length && target != message) await unmarkUnknown(target)
    if (saved.length) return reply(saved.map(r => r.message).join('\n'))
    if (results.some(r => r.error)) return reply(results.find(r => r.error).error)
    return reply(target != message || src.content || src.attachments.length
        ? "I couldn't find an arcade run in that. Add the event and time, like `@Autopilot Ramjet Run 1:13.59`."
        : 'Mention me with an event and a time (`@Autopilot Ramjet Run 1:13.59`), or with a screenshot or YouTube link of the run.')
}
