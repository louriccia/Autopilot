const { pingMessage } = require('../commands/ping.js')

module.exports = {
    name: 'ping',
    async execute({ client, interaction, args } = {}) {
        if (args[0] == 'refresh') {
            await interaction.update(pingMessage(client))
        }
    }
}
