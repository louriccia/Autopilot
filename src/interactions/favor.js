const { navigate } = require('../respond.js')
const { favorInfo } = require('../swgr/pages.js')

// "favor" menu (value = favor id), "favor_<id>" buttons
module.exports = {
    name: 'favor',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, favorInfo(interaction.values?.[0] ?? args[0]))
    }
}
