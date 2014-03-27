global._ = require('lodash');

global.l = function() {
    console.log.apply(this, ['[DEBUG]'].concat(_.toArray(arguments)));
};

global.fl = function(str) {
    var moment = require('moment');
    require('fs').appendFile(__dirname + '/logs/' + moment().format('DD_MMM_YYYY') + '.log', '[' + moment().format('hh:mm:ss') +  '] ' + str + "\n", function(err) {});
};
