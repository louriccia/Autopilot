// Official Steam announcements for the game (the store's news feed, filtered to the developer's own posts; the
// feed also carries press articles). Patch notes (tagged "patchnotes") are posted in full, other news as a summary.
const { card, when } = require('./card.js')

const APP = 4078430
const FEED = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${APP}&count=10&feeds=steam_community_announcements`
const CLAN_IMAGES = 'https://clan.akamai.steamstatic.com/images/'

// Steam's BBCode -> Discord markdown (what the announcements use: lists, bold/italic, headings, links, images)
function markdown(bb) {
    return bb
        .replace(/\[img\][^[]*\[\/img\]/gi, '')
        .replace(/\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi, '[$2]($1)')
        .replace(/\[\/?(?:list|olist)\]/gi, '')
        .replace(/\[\*\]\s*/g, '- ')
        .replace(/\[h[1-3]\]([\s\S]*?)\[\/h[1-3]\]/gi, '### $1')
        .replace(/\[b\]([\s\S]*?)\[\/b\]/gi, '**$1**')
        .replace(/\[i\]([\s\S]*?)\[\/i\]/gi, '*$1*')
        .replace(/\[u\]([\s\S]*?)\[\/u\]/gi, '__$1__')
        .replace(/\[\/?[a-z0-9]+(=[^\]]*)?\]/gi, '')  // anything else
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}
const firstImage = bb => {
    const m = bb.match(/\[img\]\{STEAM_CLAN_IMAGE\}\/([^[]+)\[\/img\]/i) ?? bb.match(/\[img\](https?:[^[]+)\[\/img\]/i)
    return m ? (m[1].startsWith('http') ? m[1] : CLAN_IMAGES + m[1]) : null
}
// Cut at a paragraph (or line) break near the limit
function clip(text, limit) {
    if (text.length <= limit) return text
    const cut = text.slice(0, limit)
    const at = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'))
    return `${cut.slice(0, at > limit / 2 ? at : limit).trim()}\n…`
}

module.exports = {
    name: 'steam-news',
    channel: 'patches',
    every: 10 * 60 * 1000,
    async check(seen, { preview = false } = {}) {
        const res = await fetch(FEED)
        if (!res.ok) throw new Error(`Steam news answered ${res.status}`)
        const items = (await res.json()).appnews.newsitems
        seen.posted ??= []
        const fresh = preview ? items.slice(0, 1) : items.filter(n => !seen.posted.includes(n.gid)).reverse()  // oldest first
        seen.posted = [...new Set([...items.map(n => n.gid), ...seen.posted])].slice(0, 50)
        return fresh.map(n => {
            const patch = (n.tags ?? []).includes('patchnotes')
            const body = markdown(n.contents)
            return card({
                source: `Steam / ${patch ? 'patch notes' : 'news'} / ${when(n.date)}`,
                title: n.title,
                lines: [clip(body, patch ? 3200 : 500)],
                image: patch ? null : firstImage(n.contents),
                links: [['Read on Steam', `https://store.steampowered.com/news/app/${APP}/view/${n.gid}`]],
                color: patch ? 0xc9a227 : 0x1b2838,
            })
        })
    },
}
