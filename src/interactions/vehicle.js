const { navigate } = require('../respond.js')
const { vehicleInfo, vehicleClassInfo } = require('../swgr/pages.js')
const garage = require('../swgr/garage.js')

// "vehicle" menu (value = vehicle id), "vehicle_class" menu (value = class id). A speeder opens in the garage (its
// stock model there stands in for a vehicle card); podracers, which can't be customised yet, keep their cards
module.exports = {
    name: 'vehicle',
    async execute({ interaction, args } = {}) {
        if (args[0] == 'class') return navigate(interaction, vehicleClassInfo(interaction.values[0]))
        const id = interaction.values?.[0] ?? args[0]
        if (garage.canCustomise(id)) return garage.respond(interaction, garage.startState(id))
        await navigate(interaction, vehicleInfo(id))
    }
}
