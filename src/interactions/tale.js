const { navigate } = require('../respond.js')
const { taleInfo } = require('../swgr/pages.js')

// "tale" menu (value = tale id), "tale_<id>" previous / next buttons
module.exports = {
    name: 'tale',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, taleInfo(interaction.values?.[0] ?? args[0]))
    }
}
