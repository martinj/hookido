'use strict';

const Hapi = require('hapi');
const plugin = require('../');
const expect = require('chai').expect;
const nock = require('nock');

describe('Hookido Hapi Plugin', () => {

	it('merges route options with route', (done) => {

		const server = new Hapi.Server();
		server.connection();

		server.register({
			register: plugin,
			options: {
				topicArn: 'foo',
				route: {
					path: '/foobar'
				},
				handlers: {
					notification: () => {}
				}
			}
		}, (err) => {
			if (err) {
				return done(err);
			}

			const table = server.connections[0].table();
			expect(table[0].path).to.equal('/foobar');
			done();
		});

	});

	it('sends subscribe request onPostStart if subscribe option is set', (done) => {

		const server = new Hapi.Server();
		server.connection();

		server.register({
			register: plugin,
			options: {
				topicArn: 'foo',
				subscribe: {
					endpoint: 'http://foo.com',
					protocol: 'HTTP'
				},
				handlers: {
					notification: () => {}
				}
			}
		}, (err) => {
			if (err) {
				return done(err);
			}

			server.plugins.hookido.sns.subscribe = (protocol, endpoint) => {

				expect(protocol).to.equal('HTTP');
				expect(endpoint).to.equal('http://foo.com');
				return Promise.resolve();

			};

			server.start((err) => {
				if (err) {
					return done(err);
				}

				server.stop(done);
			});
		});

	});

	it('sends setTopicAttributes request onPostStart if topicAttributes option is set', (done) => {

		const server = new Hapi.Server();
		server.connection();

		server.register({
			register: plugin,
			options: {
				topicArn: 'foo',
				topicAttributes: {
					foo: 'bar'
				},
				handlers: {
					notification: () => {}
				}
			}
		}, (err) => {
			if (err) {
				return done(err);
			}

			server.plugins.hookido.sns.setTopicAttributes = (attributes) => {
				expect(attributes).to.deep.equal({foo: 'bar'});
				return Promise.resolve();
			};

			server.start((err) => {
				if (err) {
					return done(err);
				}

				server.stop(done);
			});
		});

	});

	it('dispatches SNS message of type Notification to configured handler', () => {

		const server = new Hapi.Server();
		server.connection();

		const payload = {Type: 'Notification'};


		return server
			.register({
				register: plugin,
				options: {
					topicArn: 'foo',
					skipPayloadValidation: true,
					handlers: {
						notification: (req, reply, payload) => {
							reply({called: true});
						}
					}
				}
			})
			.then(() => server.inject({method: 'POST', url: '/hookido', payload}))
			.then((res) => {

				expect(res.statusCode).to.equal(200);
				expect(res.result).to.deep.equal({called: true});

			});

	});

	it('dispatches SNS message of type SubscriptionConfirmation to configured handler', () => {

		const server = new Hapi.Server();
		server.connection();

		const payload = {Type: 'SubscriptionConfirmation'};


		return server
			.register({
				register: plugin,
				options: {
					topicArn: 'foo',
					skipPayloadValidation: true,
					handlers: {
						notification() {},
						subscriptionconfirmation: (req, reply, payload) => {
							reply({called: true});
						}
					}
				}
			})
			.then(() => server.inject({method: 'POST', url: '/hookido', payload}))
			.then((res) => {

				expect(res.statusCode).to.equal(200);
				expect(res.result).to.deep.equal({called: true});

			});
	});

	describe('ConfirmSubscription', () => {

		afterEach(() => nock.cleanAll());

		it('handles SubscriptionConfirmation if no handler is registered for that type', () => {
			const confirmRequest = nock('http://localtest.com')
				.get('/foo')
				.reply(200);

			const server = new Hapi.Server();
			server.connection();

			const payload = {
				Type: 'SubscriptionConfirmation',
				SubscribeURL: 'http://localtest.com/foo'
			};


			return server
				.register({
					register: plugin,
					options: {
						topicArn: 'foo',
						skipPayloadValidation: true,
						handlers: {
							notification() {}
						}
					}
				})
				.then(() => server.inject({method: 'POST', url: '/hookido', payload}))
				.then((res) => {


					expect(res.statusCode).to.equal(200);
					expect(confirmRequest.isDone()).to.be.true;

				});

		});

	});
});
