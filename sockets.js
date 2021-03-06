const socketIO = require('socket.io'),
  uuid = require('node-uuid'),
  crypto = require('crypto');

const redisAdapter = require('socket.io-redis');

function getRedisAdapter(config) {
  if (config.redis.url) {
    return redisAdapter(config.redis.url, config.redis)
  }
  return redisAdapter(config.redis)
}

function redisAdapterFactory(config) {
  const adapter = getRedisAdapter(config);
  adapter.pubClient.on('error', function(e){
    console.error('redisAdapter.pubClient error:', e);
  });
  adapter.subClient.on('error', function(e){
    console.error('redisAdapter.subClient error:', e);
  });
  return adapter;
}

module.exports = function (server, config) {
  let io;
  if (config.cluster) {
    io = socketIO(server);
    io.adapter(getRedisAdapter(config));
  } else {
    io = socketIO.listen(server);
    if (config.redis) {
      io.adapter(redisAdapterFactory(config));
    }
  }

  io.sockets.on('connection', function (client) {
    client.resources = {
      screen: false,
      video: true,
      audio: false
    };

    // pass a message to another id
    client.on('message', function (details) {
      if (!details) return;

      var otherClient = io.to(details.to);
      if (!otherClient) return;

      details.from = client.id;
      details.pid = process.pid;
      otherClient.emit('message', details);
    });

    client.on('shareScreen', function () {
      client.resources.screen = true;
    });

    client.on('unshareScreen', function (type) {
      client.resources.screen = false;
    });

    client.on('join', join);

    function join(name, cb) {
      // sanity check
      if (typeof name !== 'string') return;
      // check if maximum number of clients reached
      if (config.rooms && config.rooms.maxClients > 0 &&
          clientsInRoom(name) >= config.rooms.maxClients) {
        safeCb(cb)('full');
        return;
      }

      if (cb) {
        safeCb(cb)(null, describeRoom(name));
      }

      client.join(name);
    }

    client.on('disconnect', function () {
    });

    client.on('listroom', function(name, cb) {
      if (name && cb) {
        safeCb(cb)(name, describeRoom(name));
      }
    });

    client.on('leave', function (room) {
      if (room) {
        client.leave(room);
      } else {
        client.leaveAll();
      }
    });

    client.on('create', function (name, cb) {
      if (arguments.length == 2) {
        cb = (typeof cb == 'function') ? cb : function () {};
        name = name || uuid();
      } else {
        cb = name;
        name = uuid();
      }
      // check if exists
      var room = io.nsps['/'].adapter.rooms[name];
      if (room && room.length) {
        safeCb(cb)('taken');
      } else {
        join(name);
        safeCb(cb)(null, name);
      }
    });

    // support for logging full webrtc traces to stdout
    // useful for large-scale error monitoring
    client.on('trace', function (data) {
      console.log('trace', JSON.stringify(
        [data.type, data.session, data.prefix, data.peer, data.time, data.value]
      ));
    });


    // tell client about stun and turn servers and generate nonces
    client.emit('stunservers', config.stunservers || []);

    // create shared secret nonces for TURN authentication
    // the process is described in draft-uberti-behave-turn-rest
    var credentials = [];
    // allow selectively vending turn credentials based on origin.
    var origin = client.handshake.headers.origin;
    if (!config.turnorigins || config.turnorigins.indexOf(origin) !== -1) {
      config.turnservers.forEach(function (server) {
        var hmac = crypto.createHmac('sha1', server.secret);
        // default to 86400 seconds timeout unless specified
        var username = Math.floor(new Date().getTime() / 1000) + (parseInt(server.expiry || 86400, 10)) + "";
        hmac.update(username);
        credentials.push({
          username: username,
          credential: hmac.digest('base64'),
          urls: server.urls || server.url
        });
      });
    }
    client.emit('turnservers', credentials);
  });

  function describeRoom(name) {
    var adapter = io.nsps['/'].adapter;
    var clients = adapter.rooms[name] ? adapter.rooms[name].sockets : {};
    var result = {
      clients: {}
    };
    Object.keys(clients).forEach(function (id) {
      result.clients[id] = adapter.nsp.connected[id].resources;
    });
    return result;
  }

  function clientsInRoom(name) {
    return io.sockets.clients(name).length;
  }

  return io;
};

function safeCb(cb) {
  if (typeof cb === 'function') {
    return cb;
  } else {
    return function () {};
  }
}
