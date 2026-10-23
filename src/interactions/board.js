const { navigate } = require('../respond.js')
const { arcadeOverview, arcadeCategory } = require('../swgr/pages.js')
const { racerOf } = require('../commands/timesheet.js')

// A cumulative board's view buttons and podium page turners: board_<view>_<target>_<racer>[_<page>] (pages.addCumulative),
// target 'main' (the arcade's front page, the timesheet of <racer>, '-' for none) or a category id
module.exports = {
    name: 'board',
    async execute({ interaction, args } = {}) {
        const [view, target, racer, page] = args
        const shown = { view, page: +page || 0 }
        await navigate(interaction, target == 'main'
            ? arcadeOverview(racer == '-' ? null : await racerOf(interaction, racer), shown)
            : arcadeCategory(target, shown))
    }
}
