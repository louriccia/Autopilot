const { navigate } = require('../respond.js')
const { arcadeOverview, arcadeCategory, arcadeEvent, scenarioInfo, tourInfo, fullGameInfo, creditsCard } = require('../swgr/pages.js')
const { racerOf } = require('../commands/timesheet.js')

// The credits card's "Recent transactions" menu (ledger_<racer>): a value is <board>:<n> (arcade:<event>,
// scenario:<id>, tour:<id>, aggregate:<main | category>) or -:<n> for an entry with no board, which just redraws the card
module.exports = {
    name: 'ledger',
    async execute({ interaction, args } = {}) {
        const [kind, target] = interaction.values[0].split(':')
        if (kind == 'arcade') return navigate(interaction, arcadeEvent(target))
        if (kind == 'scenario') return navigate(interaction, scenarioInfo(target))
        if (kind == 'tour') return navigate(interaction, tourInfo(target))
        if (kind == 'fullgame') return navigate(interaction, fullGameInfo(target))
        if (kind == 'aggregate') return navigate(interaction, target == 'main' ? arcadeOverview(await racerOf(interaction, interaction.user.id)) : arcadeCategory(target))
        await navigate(interaction, creditsCard(await racerOf(interaction, args[0])))
    }
}
