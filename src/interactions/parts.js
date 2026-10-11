const { navigate } = require('../respond.js')
const { partInfo, parseKeywordMask } = require('../swgr/pages.js')

// The parts finder menus on part cards. These refresh only the menus; the part on show stays the same.
//   parts_filter_<partId|->            keyword multi-select (list back to page 1)
//   parts_page_<partId|->_<mask>_<n>   list page buttons
module.exports = {
    name: 'parts',
    async execute({ interaction, args } = {}) {
        const part = id => id && id != '-' ? id : null
        if (args[0] == 'filter') await navigate(interaction, partInfo(part(args[1]), interaction.values.map(Number), 1))
        if (args[0] == 'page') await navigate(interaction, partInfo(part(args[1]), parseKeywordMask(args[2]), Number(args[3]) || 1))
    }
}
