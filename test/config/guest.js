'use strict';

const Lab = require('lab');
const Code = require('code');
const Fixtures = require('../fixtures');
const { db, Server } = Fixtures;

const lab = exports.lab = Lab.script();

const { describe, it, before } = lab;
const { expect } = Code;

describe('Guest account', () => {

  let server;

  before(async () => {

    server = await Server;
  });

  it('created and exists', () => {

    let guestUser;
    const iceServers = Fixtures.iceServers();

    return server.inject({ method: 'POST', url: '/config/guest', payload: {} })
      .then((res) => {

        expect(res.statusCode).to.equal(200);
        return res.result;
      }).then((result) => {

        guestUser = result;
        expect(guestUser.iceServers).to.part.include(iceServers);
        expect(guestUser.iceServers[0]).to.include(['username', 'password']);
        return Fixtures.getAdminUrl(server, `/dashboard/sessions/${guestUser.id}`);
      }).then((res) => {

        expect(res.statusCode).to.equal(200);

        const newRoom = Fixtures.room();
        const payload = {
          room_id: newRoom.id,
          user_id: guestUser.userId,
          session_id: guestUser.id
        };
        const headers = {
          authorization: Fixtures.prosodyBasicHeader('testUser')
        };

        return server.inject({ method: 'POST', url: '/prosody/rooms/user-info', payload, headers });
      }).then((res) => {

        expect(res.statusCode).to.equal(200);
        return res.result;
      }).then((result) => {

        expect(result).to.include({ userType: 'guest', id: guestUser.id });
        return db.sessions.destroy({ id: guestUser.id });
      });
  });
});
