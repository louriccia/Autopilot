const { navigate } = require('../respond.js')
const { styleInfo } = require('../swgr/pages.js')

// "style" select (value = style id) or "style_<id>" button
module.exports = {
    name: 'style',
    async execute({ interaction, args } = {}) {
        await navigate(interaction, styleInfo(interaction.values?.[0] ?? args[0]))
    }
}
