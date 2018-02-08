'use strict';

const { promisify } = require('util');

const internals = {};

internals.empty_event = {
  created_at: null,
  server: null,
  org_id: null,
  bytes_sent: 0,
  bytes_received: 0
};


class ICEWorker {

  constructor(options) {

    this.working = Promise.resolve();
    this.timeout = 1000; // 1 second
    this.batch = 25; // 25 events at a time
    this.db = options.db;
    this.run = false;
    this.redis = options.redis;
    this.redis_lrange = promisify(this.redis.lrange.bind(this.redis));
    this.redis_ltrim = promisify(this.redis.ltrim.bind(this.redis));
    this.redis_set = promisify(this.redis.set.bind(this.redis));
    this.redis_rpush = promisify(this.redis.rpush.bind(this.redis));
    this.redis_hincrby = promisify(this.redis.hincrby.bind(this.redis));
    this.redis_sadd = promisify(this.redis.sadd.bind(this.redis));
  }

  async start() {

    //Await stop()
    await this.stop();
    this.run = true;
    this.work();
  }

  async stop() {

    this.run = false;
    await this.working;
  }

  //Main worker loop
  async work() {

    await this.working; //Make sure our former self is done
    if (this.run) {
      this.working = new Promise(async (resolve, reject) => {

        const events = await this.redis_lrange('ice_events', 0, this.batch - 1);
        if (events.length) {
          for (const event_json of events) {
            const event = { ...internals.empty_event, ...JSON.parse(event_json) }; //Set nulls where needed

            await this.update_ice_state(event);

            const clock = Number(new Date(event.created_at));
            await this.redis_set('ice_events_clock', clock);
          }
        }

        await this.redis_ltrim('ice_events', this.batch, -1);
        if (events.length === this.batch) {
          setImmediate(this.work.bind(this)); //immediately try again
        }
        else {
          setTimeout(this.work.bind(this), this.timeout); //try again after a period of time
        }

        resolve();
        return;
      });
    }
  }

  async update_ice_state(event) {

    let success = true;
    try {

      await Promise.all([
        this.redis_hincrby('ice_usage_by_server_recv', event.server, event.bytes_received),
        this.redis_hincrby('ice_usage_by_server_sent', event.server, event.bytes_sent),
        this.redis_hincrby('ice_count_by_server', event.server, 1),
        this.redis_hincrby('ice_usage_by_org_recv', event.org_id, event.bytes_received),
        this.redis_hincrby('ice_usage_by_org_sent', event.org_id, event.bytes_sent),
        this.redis_hincrby('ice_count_by_org', event.server, 1)
      ]);
    }
    catch (err) {

      console.log(err.stack);
      success = false;
    }

    return success;
  }
}

module.exports = ICEWorker;