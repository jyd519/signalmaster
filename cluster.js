const yetify = require('yetify'),
  config = require('getconfig'),
  fs = require('fs'),
  net = require('net'),
  sockets = require('./sockets'),
  farmhash = require('farmhash');

const cluster = require("cluster");
const http = require("http");

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

	// Create the outside facing server listening on our port.
	var server = net.createServer({ pauseOnConnect: true }, function(connection) {
		// We received a connection and need to pass it to the appropriate
		// worker. Get the worker for this connection's source IP and pass
		// it the connection.
		var worker = workers[worker_index(connection.remoteAddress, numCPUs)];
		worker.send('sticky-session:connection', connection);
	}).listen(port);

  let httpUrl;
  if (config.server.secure) {
    httpUrl = "https://localhost:" + port;
  } else {
    httpUrl = "http://localhost:" + port;
  }

  console.log(yetify.logo() + ' -- signal master is running at: ' + httpUrl);
} else {
  console.log(`Worker ${process.pid} started`);
  config.cluster = true;
  const httpServer = http.createServer(server_handler);
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
