const { navigate } = require('../respond.js')
const data = require('../swgr/data.js')
const { abilityInfo } = require('../swgr/pages.js')

// "ability" menus (value = ability id), "ability_<id>" family buttons, "ability_family" menu (value = family id)
module.exports = {
    name: 'ability',
    async execute({ interaction, args } = {}) {
        if (args[0] == 'family') return navigate(interaction, abilityInfo(data.abilitiesInFamily(interaction.values[0])[0].id))
        await navigate(interaction, abilityInfo(interaction.values?.[0] ?? args[0]))
    }
}
