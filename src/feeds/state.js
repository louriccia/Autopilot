// What each feed has already posted, kept across restarts in data/state/feeds.json (git-ignored)
const fs = require('node:fs')
const path = require('node:path')

const FILE = path.join(__dirname, '../../data/state/feeds.json')
let all = {}
try { all = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { all = {} }

exports.get = name => (all[name] ??= {})
exports.save = () => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2) + '\n')
}
