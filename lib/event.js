
/**
 * Events
 */

'use strict';

/**
 * Module dependencies.
 */

var utils = require('./utils');
var events = require('events');
/**
 * Initialize a new `Event` client.
 */

function Event(consul) {
  this.consul = consul;
}

/**
 * Fires a new user event
 */

Event.prototype.fire = function(opts, callback) {
  if (arguments.length === 3) {
    opts = {
      name: arguments[0],
      payload: arguments[1],
    };
    callback = arguments[2];
  } else if (typeof opts === 'string') {
    opts = { name: opts };
  }

  opts = utils.normalizeKeys(opts);

  var req = {
    name: 'event.fire',
    path: '/event/fire/{name}',
    params: { name: opts.name },
    query: {},
  };

  if (!opts.name) return callback(this.consul._err('name required', req));

  var buffer;

  if (opts.hasOwnProperty('payload')) {
    buffer = Buffer.isBuffer(opts.payload);
    req.body = buffer ? opts.payload : new Buffer(opts.payload);
  }
  if (opts.node) req.query.name = opts.name;
  if (opts.service) req.query.service = opts.service;
  if (opts.tag) req.query.tag = opts.tag;

  utils.options(req, opts);

  this.consul._put(req, utils.body, function(err, data, res) {
    if (err) return callback(err, undefined, res);

    if (data.hasOwnProperty('Payload')) {
      data.Payload = utils.decode(data.Payload, { buffer: buffer });
    }

    callback(null, data, res);
  });
};

/**
 * Lists the most recent events an agent has seen
 */

Event.prototype.list = function(opts, callback) {
  if (typeof opts === 'string') {
    opts = { name: opts };
  } else if (!callback) {
    callback = opts;
    opts = {};
  }

  opts = utils.normalizeKeys(opts);

  var req = {
    name: 'event.list',
    path: '/event/list',
    query: {},
  };

  if (opts.name) req.query.name = opts.name;

  utils.options(req, opts);

  this.consul._get(req, utils.body, function(err, data, res) {
    if (err) return callback(err, undefined, res);

    data.forEach(function(item) {
      if (!item.hasOwnProperty('Payload')) return;
      item.Payload = utils.decode(item.Payload, opts);
    });

    callback(null, data, res);
  });
};

/**
 * Watches for NEW events from the agent (rev2)
 */

Event.prototype.watch = function(opts) {
  if (!opts) {
    opts = { event: null, decodePayload: true };
  } else if (typeof opts === 'string') {
    opts = { event: opts, decodePayload: true };
  } else {
    opts = utils.normalizeKeys(opts);
    if (!opts.hasOwnProperty('event')) {
      opts.event = null;
    }
    if (!opts.hasOwnProperty('decodePayload')) {
      opts.decodePayload = true;
    }
  }

  // this will return an event emitter
  var watchEvent = new events.EventEmitter();
  // keeping track of the x-consul-index
  var watchIndex = 0;
  // keeping track of lamport time
  var prevLtime = 0;
  var tempLtime = 0;

  var self = this;
  function makeWatch() {

    var timeout = 59000;
    var req = {
      name: 'event.watch',
      path: '/event/list',
      query: {
        wait: '1m',
        index: watchIndex
      },
      timeout: timeout
    };
    if (opts.event !== null) {
      req.query.name = opts.event;
    }
    self.consul._get(req, utils.body, function(err, data, res) {
      if (err) {
        // make better error handling here please
        console.log(err);
        // reloading anyway since its likely to be a timeout, you should
        // handle any other kinds of errors properly thankyouverymuch.
        makeWatch();
      } else {

        watchIndex = res.headers['x-consul-index'];
        // handles issue #361 in consul: https://github.com/hashicorp/consul/issues/361
        // remove when issue is resolved.
        // resolved in 0.4.1
        if (watchIndex.indexOf(',') > -1) {
          watchIndex = watchIndex.split(', ')[1];
        }

        for (var i in data) {
          console.log(data[i]);
          if (tempLtime === 0) {
            if (data[i].LTime > prevLtime) {
              prevLtime = data[i].LTime;
            }
          } else {
            if (data[i].LTime > prevLtime) {
              if (opts.decodePayload) {
                data[i].Payload = new Buffer(data[i].Payload, 'base64').toString();
              }
              prevLtime = data[i].LTime;
              watchEvent.emit('event', null, data[i]);
            }
          }
        }
        tempLtime = prevLtime;
        makeWatch();
      }
    });
  }
  makeWatch();
  return watchEvent;
};

/**
 * Module exports.
 */

exports.Event = Event;
