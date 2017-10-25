'use strict';

const Joi = require('joi');
const { promisify } = require('util');
const Schema = require('../../lib/schema');

module.exports = {
  description: 'Ingest metrics from clients',
  tags: ['api', 'metrics'],
  handler: async function (request, reply) {

    const { eventType, peerId, roomId, data } = request.payload;
    const session = request.auth.credentials;
    const event = {
      type: eventType,
      peer_id: peerId,
      room_id: roomId,
      actor_id: session.id,
      data: data
    };

    const rpush = promisify(this.redis.rpush);
    await rpush('events', JSON.stringify(event));

    return reply();
  },
  validate: {
    payload: {
      eventType: Schema.eventTypes,
      peerId: Joi.string(),
      roomId: Joi.string(),
      data: Joi.object().unknown().default({})
    }
  },
  auth: 'client-token'
};
