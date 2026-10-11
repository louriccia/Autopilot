// Everything /search can find. Each kind lists its items, how they read in the autocomplete list, and the
// page that opens them. When a new reference page is added (vehicles, parts, characters...), add its kind here.
const data = require('./data.js')
const pages = require('./pages.js')

const KINDS = [
    {
        kind: 'event',
        items: () => data.events,
        label: e => `${e.name} — Arcade ${data.category(e.category).name} · ${data.track(e.track).name}`,
        keywords: e => [data.track(e.track).name, data.planet(e.planet).name, e.vehicle, e.vehicleClass, data.category(e.category).name],
        page: pages.arcadeEvent,
    },
    {
        kind: 'category',
        items: () => data.categories,
        label: c => `${c.name} — Arcade category · ${data.eventsInCategory(c.id).length} events`,
        keywords: () => ['arcade'],
        page: pages.arcadeCategory,
    },
    {
        kind: 'track',
        items: () => data.tracks,
        label: t => `${t.name} — Track · ${data.planet(t.planet).name}`,
        keywords: t => [data.planet(t.planet).name, t.format, t.vehicles],
        page: pages.trackInfo,
    },
    {
        kind: 'planet',
        items: () => data.planets,
        label: p => `${p.name} — Planet`,
        keywords: p => [p.tagline],
        page: pages.planetInfo,
    },
    {
        kind: 'scenario',
        items: () => data.scenarios,
        label: sc => `${sc.name} — Scenario · ${sc.tier} · ${data.planet(sc.planet).name}`,
        keywords: sc => [sc.style.name, sc.vehicleClass, data.planet(sc.planet).name, sc.tier, 'scenario'],
        page: pages.scenarioInfo,
    },
    {
        kind: 'style',
        items: () => data.styles,
        label: s => `${s.name} — Racer style`,
        keywords: s => [s.description, ...s.ranks.flatMap(r => r.traits.map(t => t.name)), 'racer style'],
        page: pages.styleInfo,
    },
    {
        kind: 'part',
        items: () => data.parts,
        label: p => `${p.name} — Part · ${p.category} · ${p.rarity}`,
        keywords: p => [p.category, p.rarity, p.description],
        page: pages.partInfo,
    },
    {
        kind: 'keyword',
        items: () => data.partKeywords,
        label: k => `${k.name} — Parts keyword · ${k.count} parts`,
        keywords: () => ['parts', 'keyword'],
        page: id => pages.partInfo(null, [Number(id)]),
    },
    {
        kind: 'backer',
        items: () => data.sponsors,
        label: s => `${s.name} — Backer · ${s.person}`,
        keywords: s => [s.person, s.penalty, ...s.contracts.map(c => c.objective), 'backer', 'sponsor'],
        page: pages.backerInfo,
    },
    {
        kind: 'status',
        items: () => data.statuses,
        label: s => `${s.name} — Status effect · ${s.positive ? 'Positive' : 'Negative'}`,
        keywords: s => [s.description, 'status effect'],
        page: pages.statusInfo,
    },
    {
        kind: 'mystery',
        items: () => data.mysteries,
        label: m => `${m.title} — Mystery · ${m.character}`,
        keywords: m => [m.character, ...m.parts.map(p => p.brief.replace(/\{emoji:\w+\}\s*|\*\*/g, '')), 'mystery encounter'],
        page: pages.mysteryInfo,
    },
    {
        kind: 'rival',
        items: () => data.rivals,
        label: r => `${r.name} — ${r.champion ? 'Champion' : 'Rival'}`,
        keywords: r => [r.bio, r.persona, 'rival', ...r.vehicles.map(id => data.vehicle(id).name)].filter(Boolean),
        page: pages.rivalInfo,
    },
    {
        kind: 'favor',
        items: () => data.favors,
        label: f => `${f.name} — Favor · ${f.character}`,
        keywords: f => [f.character, f.ranks[0].description, 'favor', 'favour'],
        page: pages.favorInfo,
    },
    {
        kind: 'vehicle',
        items: () => data.vehicles,
        label: v => `${v.name} — ${v.class}${v.manufacturer ? ` · ${v.manufacturer}` : v.pilot ? ` · ${v.pilot}` : ''}`,
        keywords: v => [v.class, v.manufacturer, v.pilot, ...v.racers, 'vehicle'].filter(Boolean),
        page: pages.vehicleInfo,
    },
    {
        kind: 'class',
        items: () => data.classes,
        label: c => `${c.name} — Vehicle class · ${data.vehiclesInClass(c.name).length} vehicles`,
        keywords: c => [c.advanced, ...c.traits.map(t => t.name), 'vehicle class'],
        page: pages.vehicleClassInfo,
    },
    {
        kind: 'ability',
        items: () => data.abilities,
        label: a => `${a.name} — Ability · Tier ${['', 'I', 'II', 'III'][a.tier] ?? '?'}`,
        keywords: a => [a.description, 'ability'],
        page: pages.abilityInfo,
    },
    {
        kind: 'arcade',
        items: () => [{ id: 'all', name: 'Arcade' }],
        label: () => `Arcade — all ${data.events.length} events`,
        keywords: () => ['events', 'medals'],
        page: () => pages.arcadeOverview(),
    },
]
const byKind = Object.fromEntries(KINDS.map(k => [k.kind, k]))

// Exact name > name starts with the query > a word in the name starts with it > name contains it > another field does.
function score(name, keywords, q) {
    const n = name.toLowerCase()
    if (n == q) return 5
    if (n.startsWith(q)) return 4
    if (n.split(/[\s'-]+/).some(w => w.startsWith(q))) return 3
    if (n.includes(q)) return 2
    if (keywords.some(k => k?.toLowerCase().includes(q))) return 1
    return 0
}

function search(query, limit = 25) {
    const q = query.trim().toLowerCase()
    const results = []
    for (const k of KINDS) {
        for (const item of k.items()) {
            const s = q ? score(item.name ?? item.title, k.keywords(item), q) : 1  // mysteries have titles
            if (s) results.push({ s, name: k.label(item).slice(0, 100), value: `${k.kind}:${item.id}` })
        }
    }
    // Stable sort keeps KINDS order (events first) among equal scores.
    return results.sort((a, b) => b.s - a.s).slice(0, limit).map(({ name, value }) => ({ name, value }))
}

// A picked autocomplete value opens its page; free text opens the best match.
function open(value) {
    const [kind, id] = value.split(':')
    if (byKind[kind] && byKind[kind].items().some(item => item.id == id)) return byKind[kind].page(id)
    const best = search(value, 1)[0]
    return best ? open(best.value) : null
}

module.exports = { search, open }
