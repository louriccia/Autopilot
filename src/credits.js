// Credits: the bot's currency, earned for progress on the boards and spent on bounties. In the database:
//   credits/<discord id>/<push id>   the ledger: { amount, reason, ref, lines?, backer?, date }; every change is an entry
//   balances/<discord id>            the balance, only ever changed inside a transaction (with its ledger entry)
//   backers/<discord id>             { backer: hutt | broker | pirate, since }: the onboarding role they hold, and since when
//   bounties/<push id>               { kind, target, under (s), pot, funders: { id: amount }, postedBy, postedAt, expires,
//                                      status: open | won | expired, winner?, time? }
//   fills/<kind>:<target>            true once a board has reached MIN_RACERS and paid its podium (once ever)
// Earning (earnings(), from a save's before/after leaderboards) pays for what a run achieves, scaled by its proof
// (video x1, screenshot x0.75, no proof x0.25) and by the racer's backer (BACKERS); a slower run or a repeat pays
// nothing; staff don't earn (their runs become staff times before this). Removing a time takes back what it earned.
const { database } = require('./firebase.js')
const records = require('./records.js')
const data = require('./swgr/data.js')

const RATES = {
    firstBoard: 100, pbBase: 50, pbPerTenth: 10, pbCap: 500,
    medal: { bronze: 100, silver: 200, gold: 400 },
    bop: 25, bopCap: 5, rival: 150, top3: 300, wr: 1000,
    category: 500, all: 5000, rating: 10,
}
exports.RATES = RATES
exports.MIN_RACERS = 5  // podium and world-record bonuses only on boards with this many racers
const PROOF = { video: 1, screenshot: 0.75, claim: 0.25 }
const DAY = 24 * 60 * 60 * 1000

// The three backers (onboarding roles), what they boost and what they take; a backer counts once held for a day
const BACKERS = {
    hutt: { role: 'The Hutt', name: 'The Hutt', emoji: 'backer_Hutt' },
    broker: { role: 'The Broker', name: 'The Broker', emoji: 'backer_Broker' },
    pirate: { role: 'The Pirate', name: 'The Pirate', emoji: 'backer_Pirate' },
}
exports.BACKERS = BACKERS
const BACKER_HOLD = DAY

const MAIN = () => data.events.filter(e => e.category != 'Deluxe')
const MEDALS = ['bronze', 'silver', 'gold']
const fmt = s => {
    const cs = Math.round(s * 100), m = Math.floor(cs / 6000), rest = (cs % 6000) / 100
    return m ? `${m}:${rest.toFixed(2).padStart(5, '0')}` : rest.toFixed(2)
}

let ledger = {}, balances = {}, backers = {}, bounties = {}, fills = {}
exports.listen = () => {
    if (!database) return
    database.ref('credits').on('value', s => { ledger = s.val() ?? {} })
    database.ref('balances').on('value', s => { balances = s.val() ?? {} })
    database.ref('backers').on('value', s => { backers = s.val() ?? {} })
    database.ref('bounties').on('value', s => { bounties = s.val() ?? {} })
    database.ref('fills').on('value', s => { fills = s.val() ?? {} })
    records.onRemove.push((id, time) => time && exports.reverse(id, time.user))
}

exports.balance = user => balances[user] ?? 0
exports.history = user => Object.entries(ledger[user] ?? {}).map(([id, e]) => ({ id, ...e })).sort((a, b) => b.date - a.date)
exports.balances = () => Object.entries(balances).map(([user, amount]) => ({ user, amount })).sort((a, b) => b.amount - a.amount)

// Adds a ledger entry and moves the balance with it. With mustCover, it only goes through if the balance covers the
// (negative) amount; returns false then.
async function post(user, amount, entry, { mustCover = false } = {}) {
    amount = Math.round(amount)
    let ok = true
    const res = await database.ref(`balances/${user}`).transaction(v => {
        const next = (v ?? 0) + amount
        if (mustCover && next < 0) { ok = false; return undefined }
        return next
    })
    if (!ok || !res.committed) return false
    const value = { amount, date: Date.now(), ...entry }
    const ref = await database.ref(`credits/${user}`).push(value)
    ;(ledger[user] ??= {})[ref.key] = value
    balances[user] = res.snapshot.val()
    return true
}
exports.post = post

// --- backers ---

// Their backer, if they've held its role for a day (a new or changed role is recorded and starts counting now)
exports.backerOf = (user, member) => {
    const id = Object.keys(BACKERS).find(b => member?.roles?.cache?.some(r => r.name == BACKERS[b].role))
    const rec = backers[user]
    if (!id) return null
    if (!rec || rec.backer != id) { exports.setBacker(user, id); return null }
    return Date.now() - rec.since >= BACKER_HOLD ? id : null
}
exports.setBacker = async (user, id, since = Date.now()) => {
    const value = id ? { backer: id, since } : null
    await database.ref(`backers/${user}`).set(value)
    if (value) backers[user] = value
    else delete backers[user]
}
exports.backerRecord = user => backers[user] ?? null
exports.backerFromRoles = member => Object.keys(BACKERS).find(b => member?.roles?.cache?.some(r => r.name == BACKERS[b].role)) ?? null

// --- earning ---

exports.proofType = (proof, hint) => hint ?? (!proof ? 'claim' : records.isVideo(proof) ? 'video' : 'screenshot')
const medalOf = (item, time) => item.medals ? MEDALS.slice().reverse().find(m => time <= item.medals[m].seconds) ?? null : null

// What a save earns before proof and backer: [{ label, amount, kind: progress | pb | medal | bop | rival | podium | milestone }].
// before/after: the board (each racer's best, fastest first) around the save; rival: their declared rival's id;
// done: the arcade events they have a time on after the save.
exports.earnings = ({ kind, item, user, time, before, after, rival, done }) => {
    const prev = before.find(t => t.user == user)
    if (prev && time >= prev.time) return []  // not an improvement
    const rank = after.findIndex(t => t.user == user) + 1
    if (!rank || after[rank - 1].time != time) return []
    const out = []
    if (!prev) out.push({ label: `first time on ${item.name}`, amount: RATES.firstBoard, kind: 'progress' })
    else {
        const tenths = Math.floor((prev.time - time) * 10 + 1e-6)
        out.push({ label: `personal best (-${(prev.time - time).toFixed(2)})`, amount: Math.min(RATES.pbCap, RATES.pbBase + RATES.pbPerTenth * tenths), kind: 'pb' })
    }
    // Every medal reached for the first time
    if (item.medals) for (const m of MEDALS) {
        if (time <= item.medals[m].seconds && !(prev && prev.time <= item.medals[m].seconds)) out.push({ label: `${m} medal`, amount: RATES.medal[m], kind: 'medal' })
    }
    // Bops: racers who were ahead (anyone already there, for a first time) and are now behind
    const wasAhead = prev ? before.slice(0, before.indexOf(prev)) : before
    const bopped = wasAhead.filter(t => after.findIndex(a => a.user == t.user) + 1 > rank).length
    if (bopped) out.push({ label: `bop x${Math.min(bopped, RATES.bopCap)}`, amount: RATES.bop * Math.min(bopped, RATES.bopCap), kind: 'bop' })
    // Passing their rival
    const theirs = rival && after.find(t => t.user == rival)
    if (theirs && time < theirs.time && (!prev || prev.time >= theirs.time)) out.push({ label: 'past your rival', amount: RATES.rival, kind: 'rival' })
    // Podium, on a contested board
    if (after.length >= exports.MIN_RACERS) {
        const was = before.findIndex(t => t.user == user) + 1
        if (rank <= 3 && (!was || was > 3)) out.push({ label: `top 3 on ${item.name}`, amount: RATES.top3, kind: 'podium' })
        if (rank == 1 && was != 1) out.push({ label: 'world record', amount: RATES.wr, kind: 'podium' })
    }
    // Milestones, reached with a first time on an arcade board
    if (kind == 'arcade' && !prev && done) {
        const category = data.category(item.category)
        if (data.eventsInCategory(item.category).every(e => done.has(e.id))) out.push({ label: `all of ${category.name}`, amount: RATES.category, kind: 'milestone' })
        if (item.category != 'Deluxe' && MAIN().every(e => done.has(e.id))) out.push({ label: `all ${MAIN().length} events`, amount: RATES.all, kind: 'milestone' })
    }
    return out
}

// The proof multiplier and the backer's perks applied: { lines: [{ label, amount }], total, note }
exports.apply = (items, { proof = 'claim', backer = null } = {}) => {
    const mult = PROOF[proof] ?? PROOF.claim
    let lines = items.map(i => {
        let amount = i.amount * mult
        if (backer == 'hutt' && i.kind == 'podium') amount *= 1.5
        if (backer == 'broker' && (i.kind == 'pb' || i.kind == 'medal')) amount *= 1.25
        if (backer == 'pirate' && i.kind == 'bop') amount *= 2
        if (backer == 'pirate' && i.kind == 'pb') amount *= 0.75
        return { label: i.label, amount: Math.round(amount), kind: i.kind }
    })
    let note = proof == 'video' ? 'video proof' : proof == 'screenshot' ? 'screenshot x0.75' : 'no proof x0.25'
    // The Hutt keeps a tenth of everything but the podium
    if (backer == 'hutt') {
        const cut = Math.round(lines.filter(l => l.kind != 'podium').reduce((n, l) => n + l.amount, 0) * 0.1)
        if (cut) { lines.push({ label: 'Vranki keeps', amount: -cut, kind: 'cut' }); note += `, the Hutt keeps ${cut}` }
    }
    lines = lines.filter(l => l.amount)
    return { lines, total: lines.reduce((n, l) => n + l.amount, 0), note }
}

// A board reaching MIN_RACERS: its top 3 (other than whoever just filled it, who earns the normal way) get their
// podium bonus once, by their best run's proof
exports.fillPayouts = ({ kind, target, item, before, after, user }) => {
    if (before.length >= exports.MIN_RACERS || after.length < exports.MIN_RACERS || fills[`${kind}:${target}`]) return null
    return after.slice(0, 3).map((t, i) => ({ user: t.user, entry: t, items: [
        { label: `top 3 on ${item.name} (board filled)`, amount: RATES.top3, kind: 'podium' },
        ...(i == 0 ? [{ label: 'world record (board filled)', amount: RATES.wr, kind: 'podium' }] : []),
    ] })).filter(p => p.user != user)
}
exports.markFilled = async (kind, target) => { fills[`${kind}:${target}`] = true; await database.ref(`fills/${kind}:${target}`).set(true) }

// A run's credits, posted: returns { total, lines, note } (or null when it earns nothing)
exports.payRun = async ({ timeId, kind, item, user, time, before, after, proof, proofHint, member }) => {
    const done = new Set(records.allTimes().filter(t => t.user == user && t.kind == 'arcade').map(t => t.target))
    const items = exports.earnings({ kind, item, user, time, before, after, rival: records.rivalOf(user), done })
    if (!items.length) return null
    const backer = exports.backerOf(user, member)
    const result = exports.apply(items, { proof: exports.proofType(proof, proofHint), backer })
    if (!result.total) return null
    await post(user, result.total, { reason: 'run', ref: timeId, board: `${kind}:${item.id}`, lines: result.lines, backer, proof: exports.proofType(proof, proofHint) })
    return { ...result, backer }
}

// Pays the fill-up podium when a save brings a board to MIN_RACERS (members: id -> GuildMember, for backers)
exports.payFill = async ({ kind, target, item, before, after, user, guild }) => {
    const payouts = exports.fillPayouts({ kind, target, item, before, after, user })
    if (!payouts) return
    await exports.markFilled(kind, target)
    for (const p of payouts) {
        const member = await guild?.members.fetch(p.user).catch(() => null)
        const backer = exports.backerOf(p.user, member)
        const r = exports.apply(p.items, { proof: exports.proofType(p.entry.proof), backer })
        if (r.total) await post(p.user, r.total, { reason: 'board filled', ref: p.entry.id, board: `${kind}:${target}`, lines: r.lines, backer })
    }
}

// Rating a board for the first time pays a little, once
exports.payRating = async (user, kind, target) => {
    const ref = `rate:${kind}:${target}`
    if (exports.history(user).some(e => e.ref == ref)) return
    await post(user, RATES.rating, { reason: 'rated a board', ref })
}

// A removed time takes back what it earned (its run entry; fill payouts stay, the board was contested)
exports.reverse = async (timeId, user) => {
    const earned = exports.history(user).filter(e => e.ref == timeId && e.reason == 'run')
    const reversed = exports.history(user).filter(e => e.ref == timeId && e.reason == 'removed').reduce((n, e) => n - e.amount, 0)
    const owed = earned.reduce((n, e) => n + e.amount, 0) - reversed
    if (owed) await post(user, -owed, { reason: 'removed', ref: timeId })
}

// --- bounties ---

exports.openBounties = (kind, target) => Object.entries(bounties).map(([id, b]) => ({ id, ...b }))
    .filter(b => b.status == 'open' && (!kind || (b.kind == kind && b.target == target))).sort((a, b) => b.pot - a.pot)
exports.bounty = id => bounties[id] ? { id, ...bounties[id] } : null
const BOUNTY_DAYS = 14, BOUNTY_FEE = 0.05, BOUNTY_MIN = 100

// Posts a bounty for a time under `under` on a board, held from the poster's balance. Returns { id } or { error }.
exports.postBounty = async ({ user, kind, target, under, amount }) => {
    if (!Number.isInteger(amount) || amount < BOUNTY_MIN) return { error: `A bounty is at least ${BOUNTY_MIN} credits.` }
    const best = records.leaderboard(kind, target)[0]
    if (best && best.time <= under) return { error: `${fmt(best.time)} is already saved there; set the target under it.` }
    const ref = database.ref('bounties').push()
    if (!await post(user, -amount, { reason: 'bounty posted', ref: ref.key }, { mustCover: true })) return { error: `You have ${exports.balance(user)} credits; that's not enough.` }
    const value = { kind, target, under, pot: amount, funders: { [user]: amount }, postedBy: user, postedAt: Date.now(), expires: Date.now() + BOUNTY_DAYS * DAY, status: 'open' }
    await ref.set(value)
    bounties[ref.key] = value
    return { id: ref.key }
}

exports.addToBounty = async ({ user, id, amount }) => {
    const b = bounties[id]
    if (!b || b.status != 'open') return { error: "That bounty isn't open." }
    if (!Number.isInteger(amount) || amount < 1) return { error: 'Add a whole number of credits.' }
    if (!await post(user, -amount, { reason: 'bounty added to', ref: id }, { mustCover: true })) return { error: `You have ${exports.balance(user)} credits; that's not enough.` }
    await database.ref(`bounties/${id}`).transaction(v => v && v.status == 'open' ? { ...v, pot: v.pot + amount, funders: { ...v.funders, [user]: (v.funders?.[user] ?? 0) + amount } } : v)
    return { pot: (bounties[id]?.pot ?? b.pot) }
}

// A save that beats an open bounty's target with proof (screenshot or video) wins it, unless the racer funded it.
// Returns the bounties won: [{ id, pot, paid }]
exports.claimBounties = async ({ kind, target, user, time, proof, proofHint, member, timeId }) => {
    const type = exports.proofType(proof, proofHint)
    if (type == 'claim') return []
    const won = []
    for (const b of exports.openBounties(kind, target)) {
        if (time >= b.under || b.funders?.[user]) continue
        // Claim it atomically, so two saves can't both win it
        let claimed = false
        await database.ref(`bounties/${b.id}`).transaction(v => {
            if (!v || v.status != 'open') return v
            claimed = true
            return { ...v, status: 'won', winner: user, time, wonAt: Date.now(), timeId: timeId ?? null }
        })
        if (!claimed) continue
        const backer = exports.backerOf(user, member)
        const paid = Math.round(b.pot * (backer == 'pirate' ? 1.25 : 1))
        await post(user, paid, { reason: 'bounty won', ref: b.id, board: `${kind}:${target}`, backer })
        won.push({ id: b.id, pot: b.pot, paid, under: b.under })
    }
    return won
}

// Expired open bounties go back to their funders, minus the fee (none for the Broker's)
exports.expireBounties = async guild => {
    const out = []
    for (const b of exports.openBounties().filter(b => b.expires <= Date.now())) {
        let expired = false
        await database.ref(`bounties/${b.id}`).transaction(v => { if (!v || v.status != 'open') return v; expired = true; return { ...v, status: 'expired' } })
        if (!expired) continue
        for (const [user, amount] of Object.entries(b.funders ?? {})) {
            const member = await guild?.members.fetch(user).catch(() => null)
            const fee = exports.backerOf(user, member) == 'broker' ? 0 : Math.round(amount * BOUNTY_FEE)
            await post(user, amount - fee, { reason: 'bounty expired', ref: b.id, fee })
        }
        out.push(b)
    }
    return out
}

// Credits earned per backer side (runs, fills and bounties won), for the standings
exports.standings = () => {
    const sums = Object.fromEntries(Object.keys(BACKERS).map(b => [b, 0]))
    for (const entries of Object.values(ledger)) for (const e of Object.values(entries)) {
        if (e.backer && sums[e.backer] != null && ['run', 'board filled', 'bounty won'].includes(e.reason)) sums[e.backer] += e.amount
    }
    return Object.entries(sums).map(([b, amount]) => ({ backer: b, amount })).sort((a, b) => b.amount - a.amount)
}
