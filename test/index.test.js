'use strict';

const Hapi = require('@hapi/hapi');
const {mockClient} = require('aws-sdk-client-mock');
const {
	SNSClient,
	SubscribeCommand,
	SetTopicAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SetSubscriptionAttributesCommand
} = require('@aws-sdk/client-sns');
const plugin = require('../');
const {expect} = require('chai');
const sinon = require('sinon');

describe('Hookido Hapi Plugin', () => {
	let snsMock;
	let fetchStub;

	beforeEach(() => {
		snsMock = mockClient(SNSClient);
		// Mock global fetch
		fetchStub = sinon.stub(global, 'fetch');
		fetchStub.resolves(new Response());
	});

	afterEach(() => {
		snsMock.reset();
		fetchStub.restore();
	});

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

		snsMock.on(ListSubscriptionsByTopicCommand).resolves({
			Subscriptions: [{
				SubscriptionArn: 'foo',
				Protocol: 'HTTP',
				Endpoint: 'http://foo.com'
			}]
		});

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

		snsMock
			.on(ListSubscriptionsByTopicCommand)
			.rejects({code: 'NOT_FOUND'})
			.on(SubscribeCommand)
			.resolves({});

		await server.start();
		await server.stop();

		const subscribeCalls = snsMock.commandCalls(SubscribeCommand);
		expect(subscribeCalls).length(1);
		expect(subscribeCalls[0].args[0].input).to.deep.equal({
			TopicArn: 'foo',
			Protocol: 'HTTP',
			Endpoint: 'http://foo.com'
		});
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

		snsMock
			.on(ListSubscriptionsByTopicCommand)
			.resolves({
				Subscriptions: [{
					SubscriptionArn: 'PendingConfirmation',
					Protocol: 'HTTP',
					Endpoint: 'http://foo.com'
				}]
			})
			.on(SubscribeCommand)
			.resolves({});

		await server.start();
		await server.stop();

		const subscribeCalls = snsMock.commandCalls(SubscribeCommand);
		expect(subscribeCalls).length(1);
		expect(subscribeCalls[0].args[0].input).to.deep.equal({
			TopicArn: 'foo',
			Protocol: 'HTTP',
			Endpoint: 'http://foo.com'
		});
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

		snsMock.on(SetTopicAttributesCommand).resolves({});

		await server.start();
		await server.stop();

		const attributeCalls = snsMock.commandCalls(SetTopicAttributesCommand);
		expect(attributeCalls).length(1);
		expect(attributeCalls[0].args[0].input).to.deep.equal({
			TopicArn: 'foo',
			AttributeName: 'foo',
			AttributeValue: 'bar'
		});
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
		it('handles SubscriptionConfirmation if no handler is registered for that type', async () => {
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
			expect(fetchStub.calledOnce).to.be.true;
			expect(fetchStub.firstCall.args[0]).to.equal('http://localtest.com/foo');
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
			const server = new Hapi.Server();

			const payload = {
				Type: 'SubscriptionConfirmation',
				SubscribeURL: 'http://localtest.com/foo',
				TopicArn: 'mytopic'
			};

			snsMock
				.on(ListSubscriptionsByTopicCommand)
				.resolves({
					Subscriptions: [{
						TopicArn: 'mytopic',
						Protocol: 'http',
						SubscriptionArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic',
						Endpoint: 'http://foo.com/bar'
					}]
				})
				.on(SetSubscriptionAttributesCommand)
				.resolves({});

			await server.register({
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

			expect(fetchStub.calledOnce).to.be.true;
			expect(fetchStub.firstCall.args[0]).to.equal('http://localtest.com/foo');

			const attributeCalls = snsMock.commandCalls(SetSubscriptionAttributesCommand);
			expect(attributeCalls).length(1);
			expect(attributeCalls[0].args[0].input).to.deep.equal({
				SubscriptionArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic',
				AttributeName: 'foo',
				AttributeValue: 'bar'
			});
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
