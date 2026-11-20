const { createHash } = require('node:crypto')

// Store only a digest; reading the sessions table must not expose usable JWTs.
const tokenHash = token => createHash('sha256').update(token).digest('hex')

module.exports = { tokenHash }
