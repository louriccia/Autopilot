const { navigate } = require('../respond.js')
const { arcadeTimesheet } = require('../swgr/pages.js')
const { racerOf } = require('../commands/timesheet.js')

// "timesheet_<user id>" select on a timesheet: value = a category id, or "all" for the overview
module.exports = {
    name: 'timesheet',
    async execute({ interaction, args } = {}) {
        const racer = await racerOf(interaction, args[0])
        const value = interaction.values?.[0]
        await navigate(interaction, arcadeTimesheet(racer, value == 'all' ? null : value))
    }
}
