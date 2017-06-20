const Hapi = require('hapi');
const Muckraker = require('muckraker');
const Config = require('getconfig');
const Proxy = require('http-proxy');

const inflateDomains = require('./lib/domains');
const buildUrl = require('./lib/buildUrl');
const Domains = inflateDomains(Config.talky.domains);

const ProsodyAuth = require('./lib/prosodyAuth');

const Routes = require('./routes');


const server = new Hapi.Server();
const db = new Muckraker({ connection: Config.db });
server.connection(Config.server);


const wsPort = Config.isDev ? (Config.isDevTLS ? 5281: 5280): 5281;
const wsProxy = Proxy.createProxyServer({ target: `${buildUrl('ws', Domains.api, wsPort)}` });
wsProxy.on('error', (err) => {
  server.log(err, 'Prosody not responding');
});


server.register([
  {
    register: require('good'),
    options: Config.good
  },
  {
    register: require('hapi-auth-basic')
  },
  {
    register: require('hapi-auth-jwt2')
  }
]).then(() => {

  server.auth.strategy('prosody-guests', 'basic', {
    validateFunc: ProsodyAuth('guests')
  });

  server.auth.strategy('prosody-users', 'basic', {
    validateFunc: ProsodyAuth('users')
  });

  server.auth.strategy('prosody-bots', 'basic', {
    validateFunc: ProsodyAuth('bots')
  });

  server.auth.strategy('prosody-api', 'basic', {
    validateFunc: ProsodyAuth('api')
  });

  server.auth.strategy('client-token', 'jwt', {
    key: Config.auth.secret,
    validateFunc: (decoded, request, cb) => cb(null, true),
    verifyOptions: {
      algorithms: [ 'HS256' ],
      issuer: Domains.api
    }
  });

  server.listener.on('upgrade', (req, socket, head) => {
    wsProxy.ws(req, socket, head);
  });

  server.start((err) => {
    if (err) throw err;
  
    console.log(`Server running at ${server.info.uri}`);
  });
  
  server.route(Routes);
});