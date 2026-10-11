const { navigate } = require('../respond.js')
const { favorInfo } = require('../swgr/pages.js')

// "favor" menu (value = favor id)
module.exports = {
    name: 'favor',
    async execute({ interaction } = {}) {
        await navigate(interaction, favorInfo(interaction.values[0]))
    }
}
