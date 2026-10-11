const { navigate } = require('../respond.js')
const { backerInfo } = require('../swgr/pages.js')

// "backer" menu (value = sponsor id), "backer_<id>" buttons
module.exports = {
    name: 'backer',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, backerInfo(interaction.values?.[0] ?? args[0]))
    }
}
