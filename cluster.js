const yetify = require('yetify'),
  config = require('getconfig'),
  fs = require('fs'),
  sockets = require('./sockets');

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
  httpServer.listen(port);
  if (config.uid) process.setuid(config.uid);
}
