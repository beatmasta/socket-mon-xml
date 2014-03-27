// require's
var http = require('http');
var net = require('net');
var async = require('async');
var libxmljs = require('libxmljs');
var cfg = require('./config.json');

// global require's
require('./helpers');

// first request URL config
var xmlUrlSplit = cfg.xmlUrl.replace(/^http(s)?:\/\//i, '').split("/");
var xmlHostname = xmlUrlSplit[0];
var xmlPathname = '/' + xmlUrlSplit.slice(1).join('/');
var requestOptions = {
    hostname: xmlHostname,
    path: xmlPathname
};


var socketUrlNodes;
var timeOutedSockets = [];
var activeSockets = [];
var passiveSockets = [];

// initial http request to get XML string
http.get(requestOptions, function(res) {
    var xmlBuffer = '';
    var xmlDoc;
    var clientCount = 0;
    res.on('data', function(chunk) {
        xmlBuffer += chunk;
    });
    res.on('end', function() {
        xmlDoc = libxmljs.parseXmlString(xmlBuffer);
        socketUrlNodes = xmlDoc.get(cfg.xPath).childNodes();
        var asyncStack = [];
        // collect the network clients into asynchronous stack
        // to later be executed as async.parallel actions
        for ( var i in socketUrlNodes ) {
            if ( socketUrlNodes[i].name() == 'text' ) continue;
            (function(i) {
                asyncStack.push(function(asyncDone) {
                    var host = sockProp(i, 'host');
                    var port = sockProp(i, 'port');
                    switch ( sockProp(i, 'type') ) {
                        case 'socket':
                            var netClient = new net.Socket()
                            netClient.connect(port, host, function() {
                                // DEBUG
//                                l('netClient[' + (++clientCount) + '] connected at "' + host + ':' + port + '"');
                                fl('netClient[' + (++clientCount) + '] connected at "' + host + ':' + port + '"');
                            });
                            var sockBuffer = '';
                            var timeOut = null;
                            var xFlag = false;
                            netClient.on('error', function(err) {
                                passiveSockets.push(sockInfo(i));
                                fl('netClient[' + (++clientCount) + '] refused at "' + host + ':' + port + '"');
                                asyncDone();
//                                l('netClient[' + (++clientCount) + '] refused at "' + host + ':' + port + '"');
                            });
                            netClient.on('close', function(err) {
                                passiveSockets.push(sockInfo(i));
                                fl('netClient[' + (++clientCount) + '] closed at "' + host + ':' + port + '"');
                            });
                            netClient.on('timeout', function(err) {
                                passiveSockets.push(sockInfo(i));
                                fl('netClient[' + (++clientCount) + '] timed out at "' + host + ':' + port + '"');
                            });
                            netClient.on('drain', function(err) {
                                passiveSockets.push(sockInfo(i));
                                fl('netClient[' + (++clientCount) + '] drained at "' + host + ':' + port + '"');
                            });
                            netClient.on('data', function(data) {
                                if ( xFlag ) return;
                                if ( null === timeOut ) {
                                    setTimeout(timeOutSock.bind(this, i), cfg.timeOutSeconds * 1000);
                                }
                                if ( socketTimedOut(i) ) {
                                    trimBuffer(sockBuffer);
                                    if ( sockBuffer.trim() == '' ) {
                                        passiveSockets.push(sockInfo(i));
                                    } else {
                                        activeSockets.push(sockInfo(i));
                                    }
                                    netClient.destroy(); // kill client after config seconds' timeout
                                    xFlag = true;
                                    asyncDone();
                                } else {
                                    fl('Buffering socket response: ' + sockProp(i, 'type') + '://' + host + ':' + port);
                                    sockBuffer += data;
                                }
                            });
                            break;
                        case 'socketio':
                            var socket = require('socket.io-client').connect(host + ':' + port);
                            var sockEmitOriginal = socket.$emit;
                            var sockBuffer = '';
                            var timeOut = null;
                            var xFlag = false;
                            socket.on('connect_error', function(err) {
                                passiveSockets.push(sockInfo(i));
                                fl('netClient[' + (++clientCount) + '] disconnected at "' + host + ':' + port + '"');
                            });
                            socket.on('connect_timeout', function(err) {
                                passiveSockets.push(sockInfo(i));
                                fl('netClient[' + (++clientCount) + '] timed out at "' + host + ':' + port + '"');
                            });
                            socket.on('reconnect_error', function(err) {
                                passiveSockets.push(sockInfo(i));
                                fl('netClient[' + (++clientCount) + '] non-reconnected at "' + host + ':' + port + '"');
                            });
                            socket.on('reconnect_failed', function(err) {
                                passiveSockets.push(sockInfo(i));
                                fl('netClient[' + (++clientCount) + '] failed to reconnect at "' + host + ':' + port + '"');
                            });
                            socket.$emit = function() {
                                if ( xFlag ) return;
                                if ( null === timeOut ) {
                                    setTimeout(timeOutSock.bind(this, i), cfg.timeOutSeconds * 1000);
                                }
                                if ( socketTimedOut(i) ) {
                                    trimBuffer(sockBuffer);
                                    if ( sockBuffer.trim() == '' ) {
                                        passiveSockets.push(sockInfo(i));
                                    } else {
                                        activeSockets.push(sockInfo(i));
                                    }
                                    xFlag = true;
                                    asyncDone();
                                } else {
                                    var event = arguments[0];
                                    var feed  = arguments[1];
                                    if ( feed && feed != 'websocket' ) {
                                        sockBuffer += feed;
                                    }
                                    fl('Buffering emitted socket response: ' + sockProp(i, 'type') + '://' + host + ':' + port);
                                    sockEmitOriginal.apply(this, Array.prototype.slice.call(arguments));
                                }
                            };
                            break;
                        default:
                            fl('Unknown socket type: ' + sockProp(i, 'type') + '://' + host + ':' + port);
                            return json({
                                success: false,
                                error: "unknown_socket_type",
                                message: "Wrong type of socket from feed XML."
                            });
                    }
                });
            })(i);
        }
        async.parallel(asyncStack, function(err) {
            if ( err ) {
                var msg = (err.message ? err.message : err.toString());
                fl('Async error! ' + msg);
                return json({
                    success: false,
                    error: "error_checking_urls",
                    message: msg
                });
            }
            var success = (passiveSockets.length < 1);
            fl((success ? 'SUCCESS' : 'ERROR') + '! Socket detection is complete.');
            return json({
                success: success,
                error: (success ? null : "bad_sockets_detected"),
                message: (success ? "All checks have been completed successfully" : "Bad (inactive) sockets detected"),
                sockets: {
                    good: activeSockets,
                    bad: passiveSockets
                }
            });
        });
    }).on('error', function(e) {
        fl('XML get error: ' + e.message);
        return json({
            success: false,
            error: "request_xml_feed_error",
            message: e.message
        });
    });
}).on('error', function(e) {
    fl('XML get error: ' + e.message);
    return json({
        success: false,
        error: "request_xml_feed_error",
        message: e.message
    }); 
});

var timeOutSock = function(sockNum) {
    timeOutedSockets.push(sockNum);
    return timeOutedSockets;
};

var socketTimedOut = function(sockNum) {
    return (timeOutedSockets.indexOf(sockNum) !== -1);
};

var sockProp = function(sockNum, key) {
    return socketUrlNodes[sockNum].get(cfg.keys[key]).text();
};

var sockInfo = function(sockNum) {
    var info = {};
    for ( var k in cfg.keys ) {
        info[k] = sockProp(sockNum, k);
    }
    return info;
};

var trimBuffer = function(buf) {
    var tr = cfg.trimmables;
    for ( var i in tr ) {
        buf = buf.replace(tr[i], '');
    }
    return buf;
};

var json = function(object) {
    console.log(JSON.stringify(object));
    return process.exit();
};
