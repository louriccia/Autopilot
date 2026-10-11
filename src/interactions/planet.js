const { navigate } = require('../respond.js')
const { planetInfo } = require('../swgr/pages.js')

// "planet" select (value = planet id) or "planet_<id>" button
module.exports = {
    name: 'planet',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, planetInfo(interaction.values?.[0] ?? args[0]))
    }
}
