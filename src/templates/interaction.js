// Copy into src/interactions/ and rename. A component with customId "example_do_thing" reaches this
// handler with args = ['do', 'thing'] — so `name` must not contain an underscore.
module.exports = {
    name: 'example',
    async execute({ client, interaction, args, member_id, member_name, member_avatar } = {}) {
        if (args[0] == 'do') {
            await interaction.reply({ content: `Did ${args[1]}`, ephemeral: true })
        }
    }
}
