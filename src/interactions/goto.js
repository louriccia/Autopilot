const { navigate } = require('../respond.js')
const { open } = require('../swgr/search.js')

// A menu whose values are /search ids ("event:landspeeder-ace", "scenario:shade"): open that page (a function when the
// page answers the interaction itself: a speeder, in the garage)
module.exports = {
    name: 'goto',
    async execute({ interaction } = {}) {
        const page = open(interaction.values[0])
        if (typeof page == 'function') await page(interaction)
        else if (page) await navigate(interaction, page)
    }
}
