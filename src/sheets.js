// Times as CSV for spreadsheets: /times export writes them, /times import reads a file in the same layout back in
// (headers must match exactly). Rows go through src/submit.js, so an exact repeat isn't saved twice and new details
// fill in. Spreadsheets turn 18-digit Discord ids into rounded numbers and "1:08.92" into a clock time, so ids and
// times are written as ="..." text formulas (Sheets and Excel keep them as text); the import unwraps them, and falls
// back to the seconds column for a time it can't read and to the username for an id that got mangled.
const data = require('./swgr/data.js')
const records = require('./records.js')
const { submit, formatTime, clean } = require('./submit.js')

exports.HEADERS = ['entry_id', 'kind', 'board', 'board_name', 'discord_id', 'username', 'time', 'seconds', 'platform', 'proof', 'notes', 'date', 'submitted_by']
const MAX_ROWS = 5000

const boardOf = (kind, id) => kind == 'arcade' ? data.event(id) : kind == 'scenario' ? data.scenario(id) : null
const boardByName = name => {
    const n = String(name ?? '').trim().toLowerCase()
    const arcade = data.events.find(e => e.name.toLowerCase() == n), scenario = data.scenarios.find(s => s.name.toLowerCase() == n)
    return arcade ? ['arcade', arcade] : scenario ? ['scenario', scenario] : []
}

// --- CSV ---

const text = v => `="${String(v).replace(/"/g, '""')}"`  // kept as text by spreadsheets
const cell = v => {
    const s = v == null ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
// RFC 4180: quoted fields with "" escapes and line breaks; a leading BOM is dropped
exports.parse = csv => {
    const rows = [], s = csv.replace(/^﻿/, '')
    let row = [], field = '', quoted = false
    for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (quoted) {
            if (c == '"' && s[i + 1] == '"') { field += '"'; i++ }
            else if (c == '"') quoted = false
            else field += c
        } else if (c == '"' && field == '') quoted = true  // only a field's first character opens quotes (="..." stays literal)
        else if (c == ',') { row.push(field); field = '' }
        else if (c == '\n' || c == '\r') {
            if (c == '\r' && s[i + 1] == '\n') i++
            row.push(field); rows.push(row); row = []; field = ''
        } else field += c
    }
    if (field || row.length) { row.push(field); rows.push(row) }
    return rows
}
// ="..." -> ..., and a leading apostrophe (another way spreadsheets mark text)
const unwrap = v => String(v ?? '').trim().replace(/^="(.*)"$/s, '$1').replace(/^'/, '').trim()

// --- export ---

// times: records' entries (with id). names: Discord id -> username.
exports.toCsv = (times, names) => {
    const lines = [exports.HEADERS.join(',')]
    for (const t of times) {
        lines.push([
            t.id, t.kind, t.target, boardOf(t.kind, t.target)?.name ?? '', text(t.user), names[t.user] ?? '',
            text(formatTime(t.time)), t.time, t.platform ?? '', t.proof ?? '', t.notes ?? '',
            t.date ? new Date(t.date).toISOString() : '', t.submittedBy ? (/^\d+$/.test(t.submittedBy) ? text(t.submittedBy) : t.submittedBy) : '',
        ].map((v, i) => typeof v == 'string' && v.startsWith('="') ? v : cell(v)).join(','))
    }
    return '﻿' + lines.join('\r\n') + '\r\n'  // BOM + CRLF: what Excel expects
}

// --- import ---

// Returns { error } for a file that can't be read at all, else { saved, updated, deleted, unchanged, failed: [{ row,
// reason, cells }] }. A row whose entry_id is a saved time corrects that time in place (any column), or removes it if
// its time and seconds are both blank (or the time says "delete"); any other row is a new time. importer: the
// GuildMember importing, who may change anyone's times if they can submit for others, else only their own (as
// /times remove). members: the guild's members (for usernames).
exports.importCsv = async (csv, { importer, members }) => {
    const rows = exports.parse(csv).filter(r => r.some(c => c.trim()))
    if (!rows.length) return { error: 'The file is empty.' }
    const headers = rows[0].map(h => h.trim())
    if (headers.join(',') != exports.HEADERS.join(',')) {
        return { error: `The headers must match an export exactly:\n\`${exports.HEADERS.join(',')}\`\nThis file has:\n\`${headers.join(',').slice(0, 500)}\`` }
    }
    if (rows.length - 1 > MAX_ROWS) return { error: `That's ${rows.length - 1} rows; the most one import takes is ${MAX_ROWS}.` }
    const forOthers = records.canSubmitForOthers(importer)
    const mine = user => forOthers || user == importer.id
    const byUsername = new Map([...members.values()].map(m => [m.user.username.toLowerCase(), m.user]))
    const saved = new Map(records.allTimes().map(t => [t.id, t]))
    const seen = new Set()
    const result = { saved: 0, updated: 0, deleted: 0, unchanged: 0, failed: [] }
    for (const [i, cells] of rows.slice(1).entries()) {
        const row = Object.fromEntries(exports.HEADERS.map((h, j) => [h, unwrap(cells[j])]))
        const fail = reason => result.failed.push({ row: i + 2, reason, cells })  // +2: 1-based, after the header
        const existing = row.entry_id ? saved.get(row.entry_id) : null
        if (existing && seen.has(existing.id)) { fail(`entry ${existing.id} is in the file twice`); continue }
        if (existing) seen.add(existing.id)
        if (existing && !mine(existing.user)) { fail("that's someone else's time (you can only change your own)"); continue }

        // Removing: a saved time with its time and seconds cleared
        if (existing && ((!row.time && !row.seconds) || row.time.toLowerCase() == 'delete')) {
            await records.removeTime(existing.id)
            result.deleted++
            continue
        }

        // The board: kind + board id, else its name
        let kind = row.kind.toLowerCase(), item = boardOf(kind, row.board)
        if (!item) [kind, item] = boardByName(row.board_name || row.board)
        if (!item) { fail(`no arcade event or scenario "${row.board || row.board_name}"`); continue }

        // The racer: Discord id, else username
        const idOk = /^\d{17,20}$/.test(row.discord_id)
        const user = idOk ? (members.get(row.discord_id)?.user ?? await importer.client.users.fetch(row.discord_id).catch(() => null)) : null
        const racer = user ?? (row.username ? byUsername.get(row.username.replace(/^@/, '').toLowerCase()) : null)
        if (!racer) { fail(idOk ? `no Discord user with id ${row.discord_id}` : row.username ? `no member named ${row.username}` : 'no discord_id or username'); continue }
        if (racer.bot) { fail("bots don't race"); continue }
        if (!mine(racer.id)) { fail("only your own times (you can't import times for other people)"); continue }

        // The time: the time column, else seconds
        const seconds = records.parseTime(row.time) ?? (row.seconds && Number.isFinite(+row.seconds) && +row.seconds > 0 ? Math.round(+row.seconds * 100) / 100 : null)
        if (seconds == null) { fail(`"${row.time || row.seconds}" isn't a time`); continue }
        if (row.platform && !records.PLATFORMS.includes(row.platform)) { fail(`platform must be ${records.PLATFORMS.join(', ')} or empty`); continue }
        if (row.proof && !/^https?:\/\/\S+$/i.test(row.proof)) { fail('proof must be a link (starting with https://)'); continue }
        const date = row.date ? Date.parse(row.date) : NaN

        if (existing) {
            // Correcting in place: only what differs (a date within a minute counts as the same; spreadsheets drop
            // milliseconds and sometimes the time zone)
            const next = { kind, target: item.id, user: racer.id, time: seconds, platform: row.platform, proof: row.proof, notes: clean(row.notes).slice(0, 120) }
            const changes = Object.fromEntries(Object.entries(next).filter(([k, v]) => (existing[k] ?? '') != v))
            if (Number.isFinite(date) && Math.abs(date - (existing.date ?? 0)) > 60 * 1000) changes.date = date
            if (!Object.keys(changes).length) { result.unchanged++; continue }
            await records.updateTime(existing.id, { ...changes, editedBy: importer.id, editedAt: Date.now() })
            result.updated++
            continue
        }

        const res = await submit({
            kind, target: item.id, member: importer, memberId: importer.id, racer, trusted: true, keepPlatform: true, announce: false,
            time: formatTime(seconds), platform: row.platform || undefined, proof: row.proof, notes: row.notes, date: Number.isFinite(date) ? date : undefined,
        })
        if (res.error) fail(res.error)
        else if (!res.duplicate) result.saved++
        else if (res.updated?.length) result.updated++
        else result.unchanged++
    }
    return result
}

// The failed rows as a CSV with the same headers, to fix and import again (the reasons go in the reply)
exports.failedCsv = failed => '\uFEFF' + [exports.HEADERS.join(','),
    ...failed.map(f => exports.HEADERS.map((_, j) => f.cells[j] ?? '').map(v => /^=".*"$/s.test(v) ? v : cell(v)).join(','))].join('\r\n') + '\r\n'
