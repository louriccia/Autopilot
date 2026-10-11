const { navigate } = require('../respond.js')
const { partInfo, parseKeywordMask } = require('../swgr/pages.js')

// Opening a part, keeping any keyword filter (a base-36 mask) from the card it came from:
//   part_pick_<mask>   the part list (value = part id)
//   part_<id>_<mask>   tier buttons
//   part               part menus on arcade / scenario cards (value = part id, no filter)
module.exports = {
    name: 'part',
    async execute({ interaction, args } = {}) {
        if (interaction.values) {
            await navigate(interaction, partInfo(interaction.values[0], parseKeywordMask(args[0] == 'pick' ? args[1] : null)))
        } else {
            await navigate(interaction, partInfo(args[0], parseKeywordMask(args[1])))
        }
    }
}
