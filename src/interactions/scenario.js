const { navigate } = require('../respond.js')
const { scenarioInfo } = require('../swgr/pages.js')

// "scenario" select (value = scenario id) or "scenario_<id>" button
module.exports = {
    name: 'scenario',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, scenarioInfo(interaction.values?.[0] ?? args[0]))
    }
}
