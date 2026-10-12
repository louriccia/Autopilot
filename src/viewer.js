// Who an interaction is for, available to anything it runs (page builders included) without passing it along:
// bot.js runs every handler inside viewer.run(); pages read viewer.id() to show the viewer's own time.
const { AsyncLocalStorage } = require('node:async_hooks')

const store = new AsyncLocalStorage()
exports.run = (id, fn) => store.run({ id }, fn)
exports.id = () => store.getStore()?.id ?? null

// For redrawing a message in place: a public message stays the view of whoever ran the command, a private one is
// the clicker's own
exports.ownerOf = interaction => {
    const message = interaction.message
    if (!message || message.flags?.has?.(64)) return interaction.user.id  // 64: ephemeral
    return message.interactionMetadata?.user?.id ?? interaction.user.id
}
