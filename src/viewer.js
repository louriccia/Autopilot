// Who an interaction is for, available to anything it runs (page builders included) without passing it along:
// bot.js runs every handler inside viewer.run(); pages read viewer.id() to show the viewer's own time and mark their
// rival. A card redrawn in place after a rating or a submission shows the view of whoever did it.
const { AsyncLocalStorage } = require('node:async_hooks')

const store = new AsyncLocalStorage()
exports.run = (id, fn) => store.run({ id }, fn)
exports.id = () => store.getStore()?.id ?? null
