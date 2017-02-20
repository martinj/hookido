'use strict';

const Promise = require('bluebird');
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

	it('skips subscribe request if subscription exist', (done) => {

		const server = new Hapi.Server();
		server.connection();

		server.register({
			register: plugin,
			options: {
				topic: {
					arn: 'foo',
					subscribe: {
						endpoint: 'http://foo.com',
						protocol: 'HTTP'
					}
				},
				handlers: {
					notification: () => {}
				}
			}
		}, (err) => {
			if (err) {
				return done(err);
			}

			server.plugins.hookido.snsInstances[0].findSubscriptionArn = () => {
				return Promise.resolve('foo');
			};

			server.start((err) => {
				if (err) {
					return done(err);
				}

				server.stop(done);
			});
		});


	});


	it('sends subscribe request onPostStart if subscribe option is set and subscription does not exist', (done) => {

		const server = new Hapi.Server();
		server.connection();

		server.register({
			register: plugin,
			options: {
				topic: {
					arn: 'foo',
					subscribe: {
						endpoint: 'http://foo.com',
						protocol: 'HTTP'
					}
				},
				handlers: {
					notification: () => {}
				}
			}
		}, (err) => {
			if (err) {
				return done(err);
			}

			server.plugins.hookido.snsInstances[0].findSubscriptionArn = () => {
				const err = new Error();
				err.code = 'NOT_FOUND';
				return Promise.reject(err);
			};

			server.plugins.hookido.snsInstances[0].subscribe = (arn, protocol, endpoint) => {

				expect(arn).to.equal('foo');
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

	it('sends new subscribe request onPostStart if subscribe option is set and subscription is pending', (done) => {

		const server = new Hapi.Server();
		server.connection();

		server.register({
			register: plugin,
			options: {
				topic: {
					arn: 'foo',
					subscribe: {
						endpoint: 'http://foo.com',
						protocol: 'HTTP'
					}
				},
				handlers: {
					notification: () => {}
				}
			}
		}, (err) => {
			if (err) {
				return done(err);
			}

			server.plugins.hookido.snsInstances[0].findSubscriptionArn = () => {
				const err = new Error();
				err.code = 'PENDING';
				return Promise.reject(err);
			};

			server.plugins.hookido.snsInstances[0].subscribe = (arn, protocol, endpoint) => {

				expect(arn).to.equal('foo');
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
				topic: {
					arn: 'foo',
					attributes: {
						foo: 'bar'
					}
				},
				handlers: {
					notification: () => {}
				}
			}
		}, (err) => {
			if (err) {
				return done(err);
			}

			server.plugins.hookido.snsInstances[0].setTopicAttributes = (topic, attributes) => {

				expect(topic).to.equal('foo');
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
					skipPayloadValidation: true,
					handlers: {
						notification: (req, reply) => {
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
					skipPayloadValidation: true,
					handlers: {
						notification() {},
						subscriptionconfirmation: (req, reply) => {
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

		it('sets subscription attributes if supplied in options', (done) => {

			nock('http://localtest.com')
				.get('/foo')
				.reply(200);

			nock('https://sns.eu-west-1.amazonaws.com:443')
				.post('/', 'Action=ListSubscriptionsByTopic&TopicArn=mytopic&Version=2010-03-31')
				.reply(200, `
					<ListSubscriptionsByTopicResponse xmlns="http://sns.amazonaws.com/doc/2010-03-31/">
						<ListSubscriptionsByTopicResult>
							<Subscriptions>
								<member>
									<TopicArn>arn:aws:sns:us-east-1:123456789012:My-Topic</TopicArn>
									<Protocol>http</Protocol>
									<SubscriptionArn>arn:aws:sns:eu-west-1:111111111111:mytopic</SubscriptionArn>
									<Owner>123456789012</Owner>
									<Endpoint>http://foo.com/bar</Endpoint>
								</member>
							</Subscriptions>
						</ListSubscriptionsByTopicResult>
					 </ListSubscriptionsByTopicResponse>
				`)
				.post('/', 'Action=SetSubscriptionAttributes&AttributeName=foo&AttributeValue=bar&SubscriptionArn=arn%3Aaws%3Asns%3Aeu-west-1%3A111111111111%3Amytopic&Version=2010-03-31')
				.reply(200, done.bind(null, null));

			const server = new Hapi.Server();
			server.connection();

			const payload = {
				Type: 'SubscriptionConfirmation',
				SubscribeURL: 'http://localtest.com/foo'
			};


			server
				.register({
					register: plugin,
					options: {
						skipPayloadValidation: true,
						aws: {
							region: 'eu-west-1',
							accessKeyId: 'a',
							secretAccessKey: 'a'
						},
						topic: {
							arn: 'mytopic',
							subscribe: {
								protocol: 'HTTP',
								endpoint: 'http://foo.com/bar',
								attributes: {
									foo: 'bar'
								}
							}
						},
						handlers: {
							notification() {}
						}
					}
				})
				.then(() => server.inject({method: 'POST', url: '/hookido', payload}))
				.catch(done);

		});

	});

	it('supports multiple configurations', (done) => {

		const server = new Hapi.Server();
		server.connection();

		server.register({
			register: plugin,
			options: [{
				route: {
					path: '/foobar'
				},
				handlers: {
					notification: () => {}
				}
			}, {
				route: {
					path: '/foobar2'
				},
				handlers: {
					notification: () => {}
				}
			}]
		}, (err) => {
			if (err) {
				return done(err);
			}

			const table = server.connections[0].table();
			expect(table[0].path).to.equal('/foobar');
			expect(table[1].path).to.equal('/foobar2');
			expect(server.plugins.hookido.snsInstances).to.have.a.lengthOf(2);
			done();
		});

	});
});
