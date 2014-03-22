global._ = require('lodash');

global.l = function() {
    console.log.apply(this, ['[DEBUG]'].concat(_.toArray(arguments)));
};