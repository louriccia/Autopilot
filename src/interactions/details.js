const { navigate } = require('../respond.js')
const { arcadeEvent, scenarioInfo } = require('../swgr/pages.js')

// "details_<kind>_<target>_<show|hide>" beside a build: shows or hides the build's details (pages.addBuild)
const PAGES = { arcade: arcadeEvent, scenario: scenarioInfo }
module.exports = {
    name: 'details',
    async execute({ interaction, args } = {}) {
        const [kind, target, mode] = args
        if (PAGES[kind]) await navigate(interaction, PAGES[kind](target, { expanded: mode == 'show' }))
    }
}
