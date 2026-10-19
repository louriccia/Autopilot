const { navigate } = require('../respond.js')
const { characterInfo } = require('../swgr/pages.js')

// "character" menu (value = racer id), "character_<id>" buttons
module.exports = {
    name: 'character',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, characterInfo(interaction.values?.[0] ?? args[0]))
    }
}
