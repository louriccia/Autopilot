const { navigate } = require('../respond.js')
const { mysteryInfo } = require('../swgr/pages.js')

// "mystery" menu (value = mystery id)
module.exports = {
    name: 'mystery',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, mysteryInfo(interaction.values?.[0] ?? args[0]))
    }
}
