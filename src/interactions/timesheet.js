const { navigate } = require('../respond.js')
const { arcadeOverview, arcadeCategory } = require('../swgr/pages.js')
const { racerOf } = require('../commands/timesheet.js')

// "timesheet_<user id>" selects on timesheets from before they merged with the arcade overview: "all" is that racer's
// overview, anything else a category
module.exports = {
    name: 'timesheet',
    async execute({ interaction, args } = {}) {
        const value = interaction.values?.[0]
        await navigate(interaction, value == 'all' ? arcadeOverview(await racerOf(interaction, args[0])) : arcadeCategory(value))
    }
}
