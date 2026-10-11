const { navigate } = require('../respond.js')
const { paletteGroupInfo, paletteInfo, patternClassInfo, patternInfo } = require('../swgr/pages.js')

// livery_pgroup (value = palette group), livery_palette, livery_pclass (value = class id), livery_pattern
const PAGES = { pgroup: paletteGroupInfo, palette: paletteInfo, pclass: patternClassInfo, pattern: patternInfo }

module.exports = {
    name: 'livery',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, PAGES[args[0]](interaction.values[0]))
    }
}
