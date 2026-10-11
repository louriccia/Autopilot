const { navigate } = require('../respond.js')
const { open } = require('../swgr/search.js')

// A menu whose values are /search ids ("event:landspeeder-ace", "scenario:shade"): open that page
module.exports = {
    name: 'goto',
    async execute({ interaction } = {}) {
        const page = open(interaction.values[0])
        if (page) await navigate(interaction, page)
    }
}
