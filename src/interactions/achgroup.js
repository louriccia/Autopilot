const { navigate } = require('../respond.js')
const { achievementsOverview } = require('../swgr/pages.js')

// "achgroup" menu (value = achievement group id): that group's achievements
module.exports = {
    name: 'achgroup',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, achievementsOverview(interaction.values?.[0] ?? args[0]))
    }
}
