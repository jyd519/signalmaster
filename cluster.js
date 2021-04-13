const yetify = require('yetify'),
  config = require('getconfig'),
  fs = require('fs'),
  net = require('net'),
  sockets = require('./sockets'),
  farmhash = require('farmhash');

const cluster = require("cluster");

const numCPUs = require("os").cpus().length;
const port = parseInt(process.env.PORT || config.server.port, 10);

const server_handler = function (req, res) {
  if (req.url === '/healthcheck') {
    res.writeHead(200);
    res.write(new Date().toJSON() + ' ' + process.pid);
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
};

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  const workers = [];

	// Helper function for spawning worker at index 'i'.
	const spawn = function(i) {
		workers[i] = cluster.fork();

		// Optional: Restart worker on exit
		workers[i].on('exit', function(code, signal) {
			console.log('Respawning worker', i);
			spawn(i);
		});
  };

  for (let i = 0; i < numCPUs; i++) {
    spawn(i);
  }

	const worker_index = function(ip, len) {
		return farmhash.fingerprint32(ip) % len; 
	};

  let server;
  if (config.server.secure) {
    server = require('https').Server({
      key: fs.readFileSync(config.server.key),
      cert: fs.readFileSync(config.server.cert),
      passphrase: config.server.password
    }, server_handler);
  } else {
    server = require('http').Server(server_handler);
  }

  server.on('connection', function(connection) {
		// We received a connection and need to pass it to the appropriate
		// worker. Get the worker for this connection's source IP and pass
		// it the connection.
    connection.pause();
    console.log(connection.remoteAddress, connection.remotePort);
    var worker = workers[worker_index(connection.remoteAddress || '127.0.0.1', numCPUs)];
    worker.send('sticky-session:connection', connection);
  });

  let httpUrl;
  if (config.server.secure) {
    httpUrl = "https://localhost:" + port;
  } else {
    httpUrl = "http://localhost:" + port;
  }

  server.listen(port);

  console.log(yetify.logo() + ' -- signal master is running at: ' + httpUrl);
} else {
  console.log(`Worker ${process.pid} started`);

  config.cluster = true;
  let server;
  if (config.server.secure) {
    server = require('https').Server({
      key: fs.readFileSync(config.server.key),
      cert: fs.readFileSync(config.server.cert),
      passphrase: config.server.password
    }, server_handler);
  } else {
    server = require('http').Server(server_handler);
  }
  const httpServer = server;
  const io = sockets(httpServer, config);
  httpServer.listen(0, 'localhost');

  if (config.uid) process.setuid(config.uid);

	// Listen to messages sent from the master. Ignore everything else.
	process.on('message', function(message, connection) {
		if (message !== 'sticky-session:connection') {
			return;
		}

		// Emulate a connection event on the server by emitting the
		// event with the connection the master sent us.
		httpServer.emit('connection', connection);
		connection.resume();
	});
}
