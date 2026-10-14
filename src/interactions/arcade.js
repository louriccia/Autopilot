const { navigate } = require('../respond.js')
const { arcadeOverview, arcadeCategory, arcadeEvent } = require('../swgr/pages.js')
const { racerOf } = require('../commands/timesheet.js')

// arcade_category / arcade_event selects (and the timesheet's arcade_event_recent) (the category menu's "overview" goes back to the arcade's front page), or an
// arcade_event_<id> button (podium announcements)
module.exports = {
    name: 'arcade',
    async execute({ interaction, args } = {}) {
        const value = interaction.values?.[0] ?? args[1]
        if (args[0] == 'category') await navigate(interaction, value == 'overview' ? arcadeOverview(await racerOf(interaction, interaction.user.id)) : arcadeCategory(value))
        if (args[0] == 'event') await navigate(interaction, arcadeEvent(value.split(':')[0]))  // a recent run's <event>:<n>
    }
}
