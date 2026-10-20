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
        // a card is redrawn in place (a vehicle, character or event card turning into the garage, like any card's
        // buttons); a plain message gets the garage as a reply
        const inPlace = interaction.message?.flags.has(MessageFlags.IsComponentsV2)
        if (inPlace) await interaction.deferUpdate()
        else await interaction.deferReply()
        if (field == 'save' && !await garage.toggleSave(member_id, state)) {
            return interaction.followUp({ content: 'You have 25 saved builds already: unsave one first.', flags: MessageFlags.Ephemeral })
        }
        try {
            await interaction.editReply(await garage.card(state, inPlace ? interaction.message : null))
        } catch (error) {
            // the click is acknowledged already, so say so rather than leave the card as it was
            await interaction.followUp({ content: "Couldn't build that preview, try again.", flags: MessageFlags.Ephemeral }).catch(() => {})
            throw error
        }
    }
}
