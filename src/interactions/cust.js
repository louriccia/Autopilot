const { MessageFlags } = require('discord.js')
const garage = require('../swgr/garage.js')

// The garage card (src/swgr/garage.js): "cust_open_<vehicle id>" (a vehicle card's Customize button) starts a build
// of that vehicle, "cust_build_<code>" (a character's or arcade event's speeder) opens that exact build; on the card,
// "cust_<field>_<code>" menus change one field of the build in the code, the tab buttons ("cust_tab<model|vehicle|
// livery>_<code>") switch tabs, and "cust_save_<code>" saves the build for whoever clicked (or unsaves it). Composing
// the image takes a moment, so the click is acknowledged first and the card redrawn when it's ready; a redraw that
// only changes the tab or the colour page keeps the image it has.
module.exports = {
    name: 'cust',
    async execute({ interaction, args, member_id } = {}) {
        const [field, code] = args
        let state
        if (field == 'open') state = garage.startState(code)
        else if (field == 'build') state = garage.decode(code)
        else state = garage.apply(garage.decode(code), field, interaction.values?.[0])
        if (field == 'save' && !await garage.toggleSave(member_id, state)) {
            return interaction.reply({ content: 'You have 25 saved builds already: unsave one first.', flags: MessageFlags.Ephemeral })
        }
        await garage.respond(interaction, state)
    }
}
