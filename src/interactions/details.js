const { navigate } = require('../respond.js')
const { arcadeEvent, scenarioInfo, cardState } = require('../swgr/pages.js')

// "details_<kind>_<target>_<show|hide>" beside a build: shows or hides the build's details (pages.addBuild), keeping
// the rest of the card (a scenario's schedule) as it was
const PAGES = { arcade: arcadeEvent, scenario: scenarioInfo }
module.exports = {
    name: 'details',
    async execute({ interaction, args } = {}) {
        const [kind, target, mode] = args
        if (PAGES[kind]) await navigate(interaction, PAGES[kind](target, { ...cardState(interaction.message), expanded: mode == 'show' }))
    }
}
