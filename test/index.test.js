'use strict';

const Promise = require('bluebird');
const Hapi = require('@hapi/hapi');
const plugin = require('../');
const expect = require('chai').expect;
const nock = require('nock');

describe('Hookido Hapi Plugin', () => {

	it('merges route options with route', async () => {

		const server = new Hapi.Server();

		await server.register({
			plugin,
			options: {
				route: {
					path: '/foobar'
				},
				handlers: {
					notification: () => {}
				}
			}
		});

		const table = server.table();
		expect(table[0].path).to.equal('/foobar');

	});

	it('skips subscribe request if subscription exist', async () => {

		const server = new Hapi.Server();

		await server.register({
			plugin,
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
		});

		server.plugins.hookido.snsInstances[0].findSubscriptionArn = () => {
			return Promise.resolve('foo');
		};

		await server.start();
		await server.stop();

	});


	it('sends subscribe request onPostStart if subscribe option is set and subscription does not exist', async () => {

		const server = new Hapi.Server();

		await server.register({
			plugin,
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
		});

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

		await server.start();
		await server.stop();

	});

	it('sends new subscribe request onPostStart if subscribe option is set and subscription is pending', async () => {

		const server = new Hapi.Server();

		await server.register({
			plugin,
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
		});

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

		await server.start();
		await server.stop();

	});

	it('sends setTopicAttributes request onPostStart if topicAttributes option is set', async () => {

		const server = new Hapi.Server();

		await server.register({
			plugin,
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
		});

		server.plugins.hookido.snsInstances[0].setTopicAttributes = (topic, attributes) => {

			expect(topic).to.equal('foo');
			expect(attributes).to.deep.equal({foo: 'bar'});
			return Promise.resolve();

		};

		await server.start();
		await server.stop();

	});

	it('dispatches SNS message of type Notification to configured handler', async () => {

		const server = new Hapi.Server();

		const payload = {Type: 'Notification'};

		await server.register({
			plugin,
			options: {
				skipPayloadValidation: true,
				handlers: {
					notification() {
						return {called: true};
					}
				}
			}
		});

		const res = await server.inject({method: 'POST', url: '/hookido', payload});
		expect(res.statusCode).to.equal(200);
		expect(res.result).to.deep.equal({called: true});

	});

	it('dispatches SNS message of type SubscriptionConfirmation to configured handler', async () => {

		const server = new Hapi.Server();

		const payload = {Type: 'SubscriptionConfirmation'};

		await server.register({
			plugin,
			options: {
				skipPayloadValidation: true,
				handlers: {
					notification() {},
					subscriptionconfirmation() {
						return {called: true};
					}
				}
			}
		});

		const res = await server.inject({method: 'POST', url: '/hookido', payload});

		expect(res.statusCode).to.equal(200);
		expect(res.result).to.deep.equal({called: true});

	});

	describe('ConfirmSubscription', () => {

		afterEach(() => nock.cleanAll());

		it('handles SubscriptionConfirmation if no handler is registered for that type', async () => {

			const confirmRequest = nock('http://localtest.com')
				.get('/foo')
				.reply(200);

			const server = new Hapi.Server();

			const payload = {
				Type: 'SubscriptionConfirmation',
				SubscribeURL: 'http://localtest.com/foo',
				TopicArn: 'myTopicArn'
			};

			await server.register({
				plugin,
				options: {
					skipPayloadValidation: true,
					topic: {arn: 'myTopicArn'},
					handlers: {
						notification() {}
					}
				}
			});

			const res = await server.inject({method: 'POST', url: '/hookido', payload});

			expect(res.statusCode).to.equal(200);
			expect(confirmRequest.isDone()).to.be.true;

		});

		it('fails if configured topic arn doesn\'t match TopicArn in SubscriptionConfirmation payload', async () => {

			const server = new Hapi.Server();

			const payload = {
				Type: 'SubscriptionConfirmation',
				SubscribeURL: 'http://localtest.com/foo',
				TopicArn: 'evilTopic'
			};

			await server.register({
				plugin,
				options: {
					skipPayloadValidation: true,
					topic: {arn: 'myTopicArn'},
					handlers: {
						notification() {}
					}
				}
			});

			const res = await server.inject({method: 'POST', url: '/hookido', payload});

			expect(res.statusCode).to.equal(500);

		});

		it('sets subscription attributes if supplied in options', async () => {

			const mock1 = nock('http://localtest.com')
				.get('/foo')
				.reply(200);

			const mock2 = nock('https://sns.eu-west-1.amazonaws.com:443')
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
				.reply(200);

			const server = new Hapi.Server();

			const payload = {
				Type: 'SubscriptionConfirmation',
				SubscribeURL: 'http://localtest.com/foo',
				TopicArn: 'mytopic'
			};

			server.register({
				plugin,
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
			});

			await server.inject({method: 'POST', url: '/hookido', payload});

			expect(mock1.isDone()).to.be.true;
			expect(mock2.isDone()).to.be.true;

		});

	});

	it('supports multiple configurations', async () => {

		const server = new Hapi.Server();

		await server.register({
			plugin,
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
		});

		const table = server.table();

		expect(table[0].path).to.equal('/foobar');
		expect(table[1].path).to.equal('/foobar2');
		expect(server.plugins.hookido.snsInstances).to.have.a.lengthOf(2);

	});

	it('supports to load multiple times', async () => {

		const server = new Hapi.Server();

		await server.register({
			plugin,
			options: {
				route: {
					path: '/foobar'
				},
				handlers: {
					notification: () => {}
				}
			}
		});

		await server.register({
			plugin,
			options: {
				route: {
					path: '/foobar2'
				},
				handlers: {
					notification: () => {}
				}
			}
		});

		const table = server.table();

		expect(table[0].path).to.equal('/foobar');
		expect(table[1].path).to.equal('/foobar2');
		expect(server.plugins.hookido.snsInstances).to.have.a.lengthOf(2);

	});

});
