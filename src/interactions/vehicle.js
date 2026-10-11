const { navigate } = require('../respond.js')
const { vehicleInfo, vehicleClassInfo } = require('../swgr/pages.js')

// "vehicle" menu (value = vehicle id), "vehicle_class" menu (value = class id)
module.exports = {
    name: 'vehicle',
    async execute({ interaction, args } = {}) {
        if (args[0] == 'class') return navigate(interaction, vehicleClassInfo(interaction.values[0]))
        await navigate(interaction, vehicleInfo(interaction.values?.[0] ?? args[0]))
    }
}
