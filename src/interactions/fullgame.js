const { navigate } = require('../respond.js')
const { fullGameInfo } = require('../swgr/pages.js')

// "fullgame" select (value = category id) or "fullgame_<id>" button (View board on announcements)
module.exports = {
    name: 'fullgame',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, fullGameInfo(interaction.values?.[0] ?? args[0]))
    }
}
