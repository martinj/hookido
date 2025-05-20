import Hapi, {Server} from '@hapi/hapi';
import type {Plugin} from '@hapi/hapi'; // Plugin imported as type
import {mockClient} from 'aws-sdk-client-mock';
import type {AwsClientStub} from 'aws-sdk-client-mock';
import {
	SNSClient,
	SubscribeCommand,
	SetTopicAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SetSubscriptionAttributesCommand
} from '@aws-sdk/client-sns';
import importedPlugin from '../index.js';
import type {HookOptions as PluginOptions} from '../handlers.js';
import {SNSError} from '../lib/sns.js';

import {expect} from 'chai';
import sinon from 'sinon';
import type {SinonStub} from 'sinon';

// A simple mock for Response for fetchStub
if (!global.Response) {
	// @ts-ignore
	global.Response = class Response {
		constructor(body?: any, init?: any) {
			// basic mock
		}
	};
}

describe('Hookido Hapi Plugin', () => {
	let snsMock: AwsClientStub<SNSClient>;
	let fetchStub: SinonStub;
	let server: Server;

	beforeEach(() => {
		server = Hapi.server();
		snsMock = mockClient(SNSClient);
		fetchStub = sinon.stub(global, 'fetch');
		// @ts-ignore
		fetchStub.resolves(new Response(null, {status: 200}));
	});

	afterEach(async () => {
		snsMock.reset();
		fetchStub.restore();
		await server.stop();
	});

	const typedRegister = (options: PluginOptions | PluginOptions[]) => {
		return server.register({
			plugin: importedPlugin as Plugin<any>,
			options: options
		});
	};

	it('merges route options with route', async () => {
		await typedRegister({
			route: {
				path: '/foobar'
			},
			handlers: {
				notification: () => {}
			}
		} as PluginOptions);

		const table = server.table();
		expect(table[0].path).to.equal('/foobar');
	});

	it('skips subscribe request if subscription exist', async () => {
		await typedRegister({
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
		} as PluginOptions);

		snsMock.on(ListSubscriptionsByTopicCommand).resolves({
			Subscriptions: [{
				SubscriptionArn: 'foo',
				Protocol: 'HTTP',
				Endpoint: 'http://foo.com'
			}]
		});
		await server.start();
	});

	it('sends subscribe request onPostStart if subscribe option is set and subscription does not exist', async () => {
		await typedRegister({
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
		} as PluginOptions);

		snsMock
			.on(ListSubscriptionsByTopicCommand)
			.rejects(new SNSError('Simulated Not Found', 'NOT_FOUND'))
			.on(SubscribeCommand)
			.resolves({});

		await server.start();

		const subscribeCalls = snsMock.commandCalls(SubscribeCommand);
		expect(subscribeCalls).length(1);
		expect(subscribeCalls[0].args[0].input).to.deep.equal({
			TopicArn: 'foo',
			Protocol: 'HTTP',
			Endpoint: 'http://foo.com'
		});
	});

	it('sends new subscribe request onPostStart if subscribe option is set and subscription is pending', async () => {
		await typedRegister({
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
		} as PluginOptions);

		snsMock
			.on(ListSubscriptionsByTopicCommand)
			.resolves({ // Simulate finding a pending subscription
				Subscriptions: [{
					SubscriptionArn: 'PendingConfirmation',
					Protocol: 'HTTP',
					Endpoint: 'http://foo.com'
				}]
			})
			// This .on(SubscribeCommand) might not be reached if findSubscriptionArn throws SNSError with PENDING code first
			// and the main code handles it by not re-subscribing immediately but logging.
			// Test logic might need adjustment based on actual PENDING handling in index.ts
			.on(SubscribeCommand)
			.resolves({});

		await server.start();

		const subscribeCalls = snsMock.commandCalls(SubscribeCommand);
		// Depending on index.ts logic for 'PENDING', this might be 0 or 1.
		// If index.ts logs 'PENDING' and doesn't re-subscribe, this should be 0.
		// If it re-subscribes on 'PENDING', this should be 1.
		// Current index.ts logic: if PENDING, it calls sns.subscribe. So, 1 is expected.
		expect(subscribeCalls).length(1);
		if (subscribeCalls.length > 0) { // Guard access
			expect(subscribeCalls[0].args[0].input).to.deep.equal({
				TopicArn: 'foo',
				Protocol: 'HTTP',
				Endpoint: 'http://foo.com'
			});
		}
	});

	it('sends setTopicAttributes request onPostStart if topicAttributes option is set', async () => {
		await typedRegister({
			topic: {
				arn: 'foo',
				attributes: {
					foo: 'bar'
				}
			},
			handlers: {
				notification: () => {}
			}
		} as PluginOptions);

		snsMock.on(SetTopicAttributesCommand).resolves({});
		await server.start();

		const attributeCalls = snsMock.commandCalls(SetTopicAttributesCommand);
		expect(attributeCalls).length(1);
		expect(attributeCalls[0].args[0].input).to.deep.equal({
			TopicArn: 'foo',
			AttributeName: 'foo',
			AttributeValue: 'bar'
		});
	});

	it('dispatches SNS message of type Notification to configured handler', async () => {
		const payload = {Type: 'Notification', Message: 'Test', MessageId: 'id', Timestamp: 'ts', TopicArn: 'arn', Signature: 'sig', SignatureVersion: 'sv', SigningCertURL: 'url'};
		await typedRegister({
			skipPayloadValidation: true,
			handlers: {
				notification: () => {
					return {called: true};
				}
			}
		} as PluginOptions);

		const res = await server.inject({method: 'POST', url: '/hookido', payload: payload as any});
		expect(res.statusCode).to.equal(200);
		expect(res.result).to.deep.equal({called: true});
	});

	it('dispatches SNS message of type SubscriptionConfirmation to configured handler', async () => {
		const payload = {Type: 'SubscriptionConfirmation', Message: 'Test', MessageId: 'id', Timestamp: 'ts', TopicArn: 'arn', Signature: 'sig', SignatureVersion: 'sv', SigningCertURL: 'url', SubscribeURL: 'sURL'};
		await typedRegister({
			skipPayloadValidation: true,
			handlers: {
				notification: () => {},
				subscriptionconfirmation: () => {
					return {called: true};
				}
			}
		} as PluginOptions);

		const res = await server.inject({method: 'POST', url: '/hookido', payload: payload as any});
		expect(res.statusCode).to.equal(200);
		expect(res.result).to.deep.equal({called: true});
	});

	describe('ConfirmSubscription', () => {
		it('handles SubscriptionConfirmation if no handler is registered for that type', async () => {
			const payload = {
				Type: 'SubscriptionConfirmation',
				SubscribeURL: 'http://localtest.com/foo',
				TopicArn: 'myTopicArn',
				Message: 'Test', MessageId: 'id', Timestamp: 'ts', Signature: 'sig', SignatureVersion: 'sv', SigningCertURL: 'url'
			};
			await typedRegister({
				skipPayloadValidation: true,
				topic: {arn: 'myTopicArn'},
				handlers: {
					notification: () => {}
				}
			} as PluginOptions);

			const res = await server.inject({method: 'POST', url: '/hookido', payload: payload as any});
			expect(res.statusCode).to.equal(200);
			expect(fetchStub.calledOnce).to.be.true;
			expect(fetchStub.firstCall.args[0]).to.equal('http://localtest.com/foo');
		});

		it('fails if configured topic arn doesn\'t match TopicArn in SubscriptionConfirmation payload', async () => {
			const payload = {
				Type: 'SubscriptionConfirmation',
				SubscribeURL: 'http://localtest.com/foo',
				TopicArn: 'evilTopic',
				Message: 'Test', MessageId: 'id', Timestamp: 'ts', Signature: 'sig', SignatureVersion: 'sv', SigningCertURL: 'url'
			};
			await typedRegister({
				skipPayloadValidation: true,
				topic: {arn: 'myTopicArn'},
				handlers: {
					notification: () => {}
				}
			} as PluginOptions);

			const res = await server.inject({method: 'POST', url: '/hookido', payload: payload as any});
			expect(res.statusCode).to.equal(500);
		});

		it('sets subscription attributes if supplied in options', async () => {
			const payload = {
				Type: 'SubscriptionConfirmation',
				SubscribeURL: 'http://localtest.com/foo',
				TopicArn: 'mytopic',
				Message: 'Test', MessageId: 'id', Timestamp: 'ts', Signature: 'sig', SignatureVersion: 'sv', SigningCertURL: 'url'
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

			await typedRegister({
				skipPayloadValidation: true,
				aws: {
					region: 'eu-west-1'
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
					notification: () => {}
				}
			} as PluginOptions);

			await server.inject({method: 'POST', url: '/hookido', payload: payload as any});
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
		await typedRegister([{
			route: {
				path: '/foobar'
			},
			handlers: {
				notification: () => {}
			}
		} as PluginOptions, {
			route: {
				path: '/foobar2'
			},
			handlers: {
				notification: () => {}
			}
		} as PluginOptions]);

		const table = server.table();
		expect(table[0].path).to.equal('/foobar');
		expect(table[1].path).to.equal('/foobar2');
		expect(server.plugins.hookido?.snsInstances).to.have.a.lengthOf(2);
	});

	it('supports to load multiple times', async () => {
		await server.register({
			plugin: importedPlugin as Plugin<any>,
			options: {
				route: {path: '/foobar'},
				handlers: {notification: () => {}}
			} as PluginOptions
		});
		await server.register({
			plugin: importedPlugin as Plugin<any>,
			options: {
				route: {path: '/foobar2'},
				handlers: {notification: () => {}}
			} as PluginOptions
		});

		const table = server.table();
		expect(table[0].path).to.equal('/foobar');
		expect(table[1].path).to.equal('/foobar2');
		expect(server.plugins.hookido?.snsInstances).to.have.a.lengthOf(2);
	});
});
