// New uploads on the official YouTube channel(s): from the YouTube Data API (YOUTUBE_API_KEY; the channel's uploads
// playlist, one quota unit a check), else each channel's public RSS feed (which YouTube has answered 404 for at
// times). Channels are YOUTUBE_CHANNELS in .env (comma-separated channel ids), defaulting to the game's own channel.
const { card, when } = require('./card.js')

const CHANNELS = (process.env.YOUTUBE_CHANNELS || 'UC57GnaDS_gIMHRquyknLcnQ').split(',').map(c => c.trim()).filter(Boolean)

const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]
const unescape = s => (s ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")

async function videos(channelId) {
    if (process.env.YOUTUBE_API_KEY) {
        // A channel's uploads playlist is its id with UC -> UU
        const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=15&playlistId=UU${channelId.slice(2)}&key=${process.env.YOUTUBE_API_KEY}`)
        const body = await res.json()
        if (!res.ok) throw new Error(`YouTube API for ${channelId} answered ${res.status}: ${body.error?.message ?? ''}`)
        return body.items.map(({ snippet: v }) => ({
            id: v.resourceId.videoId,
            channel: v.channelTitle,
            title: v.title,
            published: Date.parse(v.publishedAt) / 1000,
            description: v.description ?? '',
            link: `https://www.youtube.com/watch?v=${v.resourceId.videoId}`,
        }))
    }
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`)
    if (!res.ok) throw new Error(`YouTube feed for ${channelId} answered ${res.status}`)
    const xml = await res.text()
    const channel = unescape(tag(xml, 'title'))
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
        id: tag(e, 'yt:videoId'),
        channel,
        title: unescape(tag(e, 'title')),
        published: Date.parse(tag(e, 'published')) / 1000,
        description: unescape(tag(e, 'media:description')),
        link: e.match(/<link rel="alternate" href="([^"]+)"/)?.[1],
    }))
}

module.exports = {
    name: 'youtube',
    channel: 'videos',
    every: 10 * 60 * 1000,
    async check(seen, { preview = false } = {}) {
        seen.posted ??= []
        const all = (await Promise.all(CHANNELS.map(videos))).flat().sort((a, b) => a.published - b.published)
        const fresh = preview ? all.slice(-1) : all.filter(v => !seen.posted.includes(v.id))
        seen.posted = [...new Set([...all.map(v => v.id), ...seen.posted])].slice(0, 200)
        return fresh.map(v => card({
            source: `YouTube / ${v.channel} / ${when(v.published)}`,
            title: v.title,
            lines: [v.description.split('\n').find(l => l.trim())?.slice(0, 300)],
            image: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            links: [['Watch on YouTube', v.link ?? `https://www.youtube.com/watch?v=${v.id}`]],
            color: 0xff0000,
        }))
    },
}
