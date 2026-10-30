const { navigate } = require('../respond.js')
const { scenarioInfo, buildExpanded } = require('../swgr/pages.js')

// "schedule_<scenario>_<show|hide>" beside a scenario's schedule: shows or hides its days (pages.scenarioInfo), keeping
// the build's details as they were
module.exports = {
    name: 'schedule',
    async execute({ interaction, args } = {}) {
        const [target, mode] = args
        await navigate(interaction, scenarioInfo(target, { expanded: buildExpanded(interaction.message), schedule: mode == 'show' }))
    }
}
