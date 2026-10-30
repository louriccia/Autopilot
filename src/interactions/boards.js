const { navigate } = require('../respond.js')
const data = require('../swgr/data.js')
const records = require('../records.js')
const { arcadeOverview, scenariosOverview, fullGameInfo, tourInfo } = require('../swgr/pages.js')
const { racerOf } = require('../commands/timesheet.js')

// The "Leaderboards" menu on every board card (pages.boardsSelect): the kind of board to go to. The arcade opens its
// front page (the viewer's timesheet), the scenarios theirs (the board over all of them); the others their first board, the full-game categories the one most people have
// run (the first ones have no runs yet)
module.exports = {
    name: 'boards',
    async execute({ interaction } = {}) {
        const kind = interaction.values[0]
        if (kind == 'arcade') return navigate(interaction, arcadeOverview(await racerOf(interaction, interaction.user.id)))
        if (kind == 'scenario') return navigate(interaction, scenariosOverview())
        if (kind == 'tour') return navigate(interaction, tourInfo(data.tours[0].id))
        const racers = c => new Set(records.leaderboard('fullgame', c.id).map(t => t.user)).size
        const busiest = data.fullGame.reduce((a, c) => racers(c) > racers(a) ? c : a)
        await navigate(interaction, fullGameInfo(busiest.id))
    }
}
