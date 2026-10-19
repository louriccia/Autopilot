// Runs src/swgr/preview.js's render off the bot's main thread: composing a speeder takes 1.5-2.5 s of solid CPU,
// which would otherwise hold up every other interaction (Discord gives a click 3 s to be acknowledged). The decoded
// passes are cached here, in the worker. Messages: { id, state } in, { id, png } or { id, error } out.
const { parentPort } = require('worker_threads')
const preview = require('./preview.js')

parentPort.on('message', ({ id, state }) => {
    try {
        const png = preview.render(state)
        parentPort.postMessage({ id, png })  // copied, not transferred: a Buffer can sit in a shared pool
    } catch (error) {
        parentPort.postMessage({ id, error: error.stack || String(error) })
    }
})
