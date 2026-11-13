'use strict'
// The deprecated lodash.isequal says: use require('node:util').isDeepStrictEqual instead.
// electron-updater compares two update descriptions read from JSON/YAML with it.
const { isDeepStrictEqual } = require('node:util')

module.exports = function isEqual(a, b) {
    return isDeepStrictEqual(a, b)
}
