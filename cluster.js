const yetify = require('yetify'),
  config = require('getconfig'),
  fs = require('fs'),
  sockets = require('./sockets');

const port = parseInt(process.env.PORT || config.server.port, 10);
const server_handler = function (req, res) {
  // Set CORS headers
	res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:8000");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "Access-Control-Allow-Headers, Origin,Accept, X-Requested-With, Content-Type, Access-Control-Request-Method, Access-Control-Request-Headers");if ( req.method === 'OPTIONS' ) {
		res.writeHead(200);
		res.end();
		return;
	}

  if (req.url === '/healthcheck') {
    console.log(Date.now(), 'healthcheck');
    res.writeHead(200);
    res.end();
    return;
  }

  res.writeHead(404);
  res.end();
};

const cluster = require("cluster");
const http = require("http");
const numCPUs = require("os").cpus().length;
const { setupMaster, setupWorker } = require("@socket.io/sticky");

if (cluster.isMaster) {
  console.log(`Master ${process.pid} is running`);

  const httpServer = http.createServer(server_handler);
  setupMaster(httpServer, {
    loadBalancingMethod: "least-connection", // either "random", "round-robin" or "least-connection"
  });
  httpServer.listen(port);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker) => {
    console.log(`Worker ${worker.process.pid} died`);
    cluster.fork();
  });

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
  setupWorker(io);
  if (config.uid) process.setuid(config.uid);
}
