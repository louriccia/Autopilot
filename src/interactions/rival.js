const { navigate } = require('../respond.js')
const { rivalInfo } = require('../swgr/pages.js')

// "rival" menu (value = rival id), "rival_<id>" buttons
module.exports = {
    name: 'rival',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, rivalInfo(interaction.values?.[0] ?? args[0]))
    }
}
