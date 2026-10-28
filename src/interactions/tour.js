const { navigate } = require('../respond.js')
const { tourInfo } = require('../swgr/pages.js')

// "tour" select (value = tour id) or "tour_<id>" button (View board on announcements, track cards)
module.exports = {
    name: 'tour',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, tourInfo(interaction.values?.[0] ?? args[0]))
    }
}
