// What people post about the game around the internet, for #community (COMMUNITY_CHANNEL_ID): the subreddit's top
// posts of the day, YouTube videos about the game that catch on and popular Twitch clips; plus news articles, which go
// with the official announcements in #news-and-media (PATCH_CHANNEL_ID). Each feed posts an item once (seen.posted)
// and at most MAX_PER_CHECK at a time.
// Each item is posted as its bare link, and Discord builds the preview: YouTube videos and Twitch clips play in the
// channel, Reddit posts and articles get their own title and picture.
const { CHANNELS: OFFICIAL } = require('./youtube.js')
const twitch = require('./twitch.js')

const MAX_PER_CHECK = 5
const SUBREDDIT = 'StarWarsGalacticRacer'
const REDDIT_TOP = 3              // a post counts once it's in the subreddit's top 3 of the day
const YOUTUBE_MIN_VIEWS = 1000    // within YOUTUBE_WINDOW of upload
const YOUTUBE_WINDOW = 2 * 864e5
const SCAM = /\b(free|crack(ed)?|download|apk|mobile|giveaway|torrent|key ?gen)\b/i
const CLIP_MIN_VIEWS = 50
const NEWS_WINDOW = 2 * 864e5     // older articles (the search digs up plenty) aren't news
// English where the source says: a YouTube video's declared language (else a title with no letters outside the Latin
// script), a clip's language (TWITCH_LANGUAGES, as for streams), Bing's US English edition
const english = lang => /^en\b/i.test(lang ?? '')
const USER_AGENT = 'autopilot-swgr/1.0 (Discord bot for the STAR WARS Galactic Racer community)'

const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]
const unescape = s => (s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#32;/g, ' ').replace(/&amp;/g, '&')
const seconds = date => Math.floor(Date.parse(date) / 1000)

// The new ones among what a feed found (the first for a preview), remembering everything it found, as messages of
// their bare links
function fresh(seen, items, preview) {
    seen.posted ??= []
    const out = preview ? items.slice(0, 1) : items.filter(i => !seen.posted.includes(i.id)).slice(0, MAX_PER_CHECK)
    seen.posted = [...new Set([...out.map(i => i.id), ...seen.posted])].slice(0, 300)
    return out.map(i => ({ content: i.link }))
}

// The subreddit's top posts of the day, from its RSS feed (Reddit's API needs approval; the feed has no scores, so
// "best" is the day's top few). Reddit rate-limits quickly: one request per check.
const reddit = {
    name: 'reddit',
    channel: 'community',
    every: 30 * 60 * 1000,
    async check(seen, { preview = false } = {}) {
        const res = await fetch(`https://www.reddit.com/r/${SUBREDDIT}/top/.rss?t=day&limit=${REDDIT_TOP}`, { headers: { 'User-Agent': USER_AGENT } })
        if (!res.ok) throw new Error(`Reddit answered ${res.status}`)
        const xml = await res.text()
        const posts = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, REDDIT_TOP)
            .map(([, e]) => ({ id: tag(e, 'id'), link: e.match(/<link href="([^"]+)"/)?.[1] }))
        return fresh(seen, posts, preview)
    },
}

// YouTube videos about the game from anyone but the official channels (the youtube feed has those), once they reach
// YOUTUBE_MIN_VIEWS within YOUTUBE_WINDOW of upload. A search costs 100 of the key's 10,000 daily quota units.
const youtube = {
    name: 'youtube-community',
    channel: 'community',
    every: 30 * 60 * 1000,
    enabled: () => !!process.env.YOUTUBE_API_KEY,
    async check(seen, { preview = false } = {}) {
        const key = process.env.YOUTUBE_API_KEY
        const after = new Date(Date.now() - YOUTUBE_WINDOW).toISOString()
        const search = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=50&relevanceLanguage=en&q=${encodeURIComponent('"Galactic Racer"')}&publishedAfter=${after}&key=${key}`)
        const found = await search.json()
        if (!search.ok) throw new Error(`YouTube search answered ${search.status}: ${found.error?.message ?? ''}`)
        const ids = found.items.filter(i => !OFFICIAL.includes(i.snippet.channelId)).map(i => i.id.videoId)
        if (!ids.length) return []
        const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(',')}&key=${key}`)
        const body = await res.json()
        if (!res.ok) throw new Error(`YouTube videos answered ${res.status}: ${body.error?.message ?? ''}`)
        // The search matches loosely; the title or description has to name the game, and the title can't be one of the
        // "get it free" scams that ride every release
        const videos = body.items
            .filter(v => /galactic racer/i.test(`${v.snippet.title} ${v.snippet.description}`) && !SCAM.test(v.snippet.title))
            .filter(v => {
                const lang = v.snippet.defaultAudioLanguage ?? v.snippet.defaultLanguage
                return lang ? english(lang) : !/[^\p{Script=Latin}\P{L}]/u.test(v.snippet.title)
            })
            .map(v => ({ id: v.id, link: `https://www.youtube.com/watch?v=${v.id}`, views: Number(v.statistics.viewCount ?? 0) }))
            .sort((a, b) => b.views - a.views)
        return fresh(seen, preview ? videos : videos.filter(v => v.views >= YOUTUBE_MIN_VIEWS), preview)
    },
}

// The day's most-viewed Twitch clips of the game, once they reach CLIP_MIN_VIEWS (Helix, the twitch feed's app token)
const clips = {
    name: 'twitch-clips',
    channel: 'community',
    every: 60 * 60 * 1000,
    enabled: () => !!(process.env.TWITCH_ID && process.env.TWITCH_SECRET),
    async check(seen, { preview = false } = {}) {
        const since = new Date(Date.now() - 864e5).toISOString()
        const found = (await twitch.helix(`clips?game_id=${twitch.GAME}&started_at=${since}&first=20`))
            .filter(c => (!twitch.LANGUAGES.length || twitch.LANGUAGES.includes(c.language)) && (preview || c.view_count >= CLIP_MIN_VIEWS))
            .sort((a, b) => b.view_count - a.view_count)
            .map(c => ({ id: c.id, link: c.url }))
        return fresh(seen, found, preview)
    },
}

// News articles about the game, from a Bing News search (its RSS). Google News's links go through a page that only
// JavaScript can follow, so Discord can't preview them; Bing's carry the article's own address (in their url=).
// The same story from several outlets has different titles, so each article posts on its own. News goes to
// #news-and-media with the official announcements, not #community.
const news = {
    name: 'bing-news',
    channel: 'patches',
    every: 2 * 60 * 60 * 1000,
    async check(seen, { preview = false } = {}) {
        const res = await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent('"Galactic Racer"')}&format=rss&setlang=en-us&mkt=en-US`, { headers: { 'User-Agent': USER_AGENT } })
        if (!res.ok) throw new Error(`Bing News answered ${res.status}`)
        const xml = await res.text()
        const articles = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, i]) => {
            const link = unescape(tag(i, 'link'))
            const url = link.match(/[?&]url=([^&]+)/)?.[1]
            return { link: url ? decodeURIComponent(url) : link, published: seconds(tag(i, 'pubDate')) }
        }).map(a => ({ ...a, id: a.link.split('?')[0] }))
            .filter(a => a.published * 1000 > Date.now() - NEWS_WINDOW).sort((a, b) => b.published - a.published)
        return fresh(seen, articles, preview)
    },
}

module.exports = [reddit, youtube, clips, news]
