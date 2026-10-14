// What people post about the game around the internet, for #community (COMMUNITY_CHANNEL_ID): the subreddit's top
// posts of the day, YouTube videos about the game that catch on, popular Twitch clips and news articles. Four feeds
// sharing one channel; each posts an item once (seen.posted) and at most MAX_PER_CHECK at a time.
const { EmbedBuilder } = require('discord.js')
const { CHANNELS: OFFICIAL } = require('./youtube.js')
const twitch = require('./twitch.js')

const MAX_PER_CHECK = 5
const SUBREDDIT = 'StarWarsGalacticRacer'
const REDDIT_TOP = 3              // a post counts once it's in the subreddit's top 3 of the day
const YOUTUBE_MIN_VIEWS = 1000    // within YOUTUBE_WINDOW of upload
const YOUTUBE_WINDOW = 2 * 864e5
const SCAM = /\b(free|crack(ed)?|download|apk|mobile|giveaway|torrent|key ?gen)\b/i
const CLIP_MIN_VIEWS = 50
const NEWS_WINDOW = 2 * 864e5     // older articles (Google News digs up plenty) aren't news
const USER_AGENT = 'autopilot-swgr/1.0 (Discord bot for the STAR WARS Galactic Racer community)'

const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]
const unescape = s => (s ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#32;/g, ' ').replace(/&amp;/g, '&')
const truncate = (s, n) => !s ? '' : s.length <= n ? s : `${s.slice(0, n - 1)}…`
const seconds = date => Math.floor(Date.parse(date) / 1000)

// A classic embed, styled like the preview Discord makes for a posted link: who posted it as the author line, the
// title linking out, a line of text, the picture, and the site and date in the footer
function embed({ author, title, url, text, image, thumbnail, site, published, color }) {
    const e = new EmbedBuilder().setColor(color).setTitle(truncate(title, 256)).setURL(url).setFooter({ text: site })
    if (author) e.setAuthor({ name: truncate(author, 256) })
    if (text) e.setDescription(truncate(text, 300))
    if (image) e.setImage(image)
    if (thumbnail) e.setThumbnail(thumbnail)
    if (published) e.setTimestamp(published * 1000)
    return { embeds: [e] }
}

// The new ones among what a feed found (all of them for a preview), remembering everything it found
function fresh(seen, items, preview) {
    seen.posted ??= []
    const out = preview ? items.slice(0, 1) : items.filter(i => !seen.posted.includes(i.id)).slice(0, MAX_PER_CHECK)
    seen.posted = [...new Set([...out.map(i => i.id), ...seen.posted])].slice(0, 300)
    return out
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
        const posts = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, REDDIT_TOP).map(([, e]) => {
            const html = unescape(unescape(tag(e, 'content')))
            return {
                id: tag(e, 'id'),
                title: unescape(tag(e, 'title')),
                author: unescape(tag(tag(e, 'author') ?? '', 'name')),
                published: seconds(tag(e, 'published')),
                link: e.match(/<link href="([^"]+)"/)?.[1],
                image: e.match(/<media:thumbnail url="([^"]+)"/)?.[1]?.replace(/&amp;/g, '&'),
                text: html.replace(/<!--[\s\S]*?-->/g, '').replace(/<br\s*\/?>|<\/p>/g, '\n').replace(/<[^>]+>/g, '')
                    .replace(/submitted by[\s\S]*$/, '').replace(/\[link\]|\[comments\]/g, '').trim(),
            }
        })
        return fresh(seen, posts, preview).map(p => embed({
            author: `${p.author} in r/${SUBREDDIT}`,
            title: p.title,
            url: p.link,
            text: p.text.split('\n').find(l => l.trim()),
            thumbnail: p.image,
            site: 'Reddit',
            published: p.published,
            color: 0xff4500,
        }))
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
        const search = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=50&q=${encodeURIComponent('"Galactic Racer"')}&publishedAfter=${after}&key=${key}`)
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
            .map(v => ({ id: v.id, title: v.snippet.title, channel: v.snippet.channelTitle, published: seconds(v.snippet.publishedAt), views: Number(v.statistics.viewCount ?? 0) }))
            .sort((a, b) => b.views - a.views)
        const popular = preview ? videos : videos.filter(v => v.views >= YOUTUBE_MIN_VIEWS)
        return fresh(seen, popular, preview).map(v => embed({
            author: v.channel,
            title: v.title,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            text: `${v.views.toLocaleString('en-US')} views`,
            image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            site: 'YouTube',
            published: v.published,
            color: 0xff0000,
        }))
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
            .filter(c => preview || c.view_count >= CLIP_MIN_VIEWS)
            .sort((a, b) => b.view_count - a.view_count)
        return fresh(seen, found, preview).map(c => embed({
            author: c.broadcaster_name,
            title: c.title || 'Untitled clip',
            url: c.url,
            text: [`${c.view_count.toLocaleString('en-US')} views`, c.creator_name && c.creator_name != c.broadcaster_name && `clipped by ${c.creator_name}`].filter(Boolean).join(' · '),
            image: c.thumbnail_url,
            site: 'Twitch clip',
            published: seconds(c.created_at),
            color: 0x6440a5,
        }))
    },
}

// News articles about the game, from a Google News search (its RSS; links go through Google News to the article).
// The same story from several outlets has different titles, so each article posts on its own.
const news = {
    name: 'news',
    channel: 'community',
    every: 2 * 60 * 60 * 1000,
    async check(seen, { preview = false } = {}) {
        const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent('"Galactic Racer"')}&hl=en-US&gl=US&ceid=US:en`, { headers: { 'User-Agent': USER_AGENT } })
        if (!res.ok) throw new Error(`Google News answered ${res.status}`)
        const xml = await res.text()
        const articles = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, i]) => {
            const outlet = unescape(tag(i, 'source'))
            return {
                id: unescape(tag(i, 'guid')) || unescape(tag(i, 'link')),
                // titles end in " - <outlet>"
                title: unescape(tag(i, 'title')).replace(new RegExp(` - ${outlet.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), ''),
                outlet,
                link: unescape(tag(i, 'link')),
                published: seconds(tag(i, 'pubDate')),
            }
        }).filter(a => a.published * 1000 > Date.now() - NEWS_WINDOW).sort((a, b) => b.published - a.published)
        return fresh(seen, articles, preview).map(a => embed({
            author: a.outlet,
            title: a.title,
            url: a.link,
            site: 'News',
            published: a.published,
            color: 0x4285f4,
        }))
    },
}

module.exports = [reddit, youtube, clips, news]
