const { MessageFlags } = require('discord.js')
const garage = require('../swgr/garage.js')

// The garage card (src/swgr/garage.js): "cust_open_<vehicle id>" (a vehicle card's Customize button) starts a build
// of that vehicle; "cust_<field>_<code>" menus change one field of the build in the code, and the Parts / Paint
// buttons switch tabs. Composing the image takes a moment, so the card is acknowledged first and redrawn when it's
// ready.
module.exports = {
    name: 'cust',
    async execute({ interaction, args } = {}) {
        const [field, code] = args
        const state = field == 'open' ? garage.startState(code) : garage.apply(garage.decode(code), field, interaction.values?.[0])
        const card = interaction.message?.flags.has(MessageFlags.IsComponentsV2)
        if (card) await interaction.deferUpdate()
        else await interaction.deferReply()
        await interaction.editReply({ ...await garage.card(state), attachments: [] })
    }
}
