const { navigate } = require('../respond.js')
const { scenarioInfo, scenariosOverview, cumulativeView } = require('../swgr/pages.js')

// "scenario" select (value = scenario id, or 'overview' for the board over all of them, keeping the view it was on) or
// "scenario_<id>" button
module.exports = {
    name: 'scenario',
    async execute({ interaction, args } = {}) {
        const id = interaction.values?.[0] ?? args[0]
        if (id == 'overview') return navigate(interaction, scenariosOverview({ view: cumulativeView(interaction.message) }))
        await navigate(interaction, scenarioInfo(id))
    }
}
