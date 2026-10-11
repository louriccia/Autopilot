const { navigate } = require('../respond.js')
const { statusInfo } = require('../swgr/pages.js')

// "status" menu (value = status effect id)
module.exports = {
    name: 'status',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, statusInfo(interaction.values?.[0] ?? args[0]))
    }
}
