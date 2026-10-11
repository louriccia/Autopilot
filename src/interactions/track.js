const { navigate } = require('../respond.js')
const { trackInfo } = require('../swgr/pages.js')

// "track" select (value = track id) or "track_<id>" button
module.exports = {
    name: 'track',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, trackInfo(interaction.values?.[0] ?? args[0]))
    }
}
