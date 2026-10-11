const { navigate } = require('../respond.js')
const { arcadeCategory, arcadeEvent } = require('../swgr/pages.js')

// arcade_category / arcade_event selects
module.exports = {
    name: 'arcade',
    async execute({ interaction, args } = {}) {
        const value = interaction.values?.[0]
        if (args[0] == 'category') await navigate(interaction, arcadeCategory(value))
        if (args[0] == 'event') await navigate(interaction, arcadeEvent(value))
    }
}
