const { navigate } = require('../respond.js')
const { achievementInfo } = require('../swgr/pages.js')

// "achievement" menu (value = achievement id)
module.exports = {
    name: 'achievement',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, achievementInfo(interaction.values?.[0] ?? args[0]))
    }
}
