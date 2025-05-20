import {mockClient} from 'aws-sdk-client-mock';
import type {AwsClientStub} from 'aws-sdk-client-mock';
import {
	SNSClient,
	SubscribeCommand,
	SetTopicAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SetSubscriptionAttributesCommand
} from '@aws-sdk/client-sns';
import SNS, {SNSError} from '../../lib/sns.js'; // Import SNSError
import {expect} from 'chai';

describe('SNS', () => {
	let sns: SNS;
	let snsMock: AwsClientStub<SNSClient>;

	beforeEach(() => {
		snsMock = mockClient(SNSClient);
		sns = new SNS({region: 'eu-west-1'});
	});

	afterEach(() => {
		snsMock.reset();
	});

	describe('#validatePayload', () => {
		it('rejects on invalid JSON', async () => {
			try {
				await sns.validatePayload('ada');
				throw new Error('Expected error');
			} catch (err: unknown) {
				expect((err as Error).message).to.match(/Invalid SNS payload: /); // More generic match
			}
		});

		it('rejects on non-object payload (like null or invalid JSON string that results in non-object)', async () => {
			try {
				// Testing with a string that's not a JSON object, or a type not handled
				await sns.validatePayload('null'); // 'null' string becomes null value then error
				throw new Error('Expected error');
			} catch (err: unknown) {
				expect((err as Error).message).to.equal('Invalid SNS payload: Not a valid JSON object');
			}
		});

		it('rejects on invalid SNS message structure (if not skipping validation)', async () => {
			try {
				await sns.validatePayload('{"foo":"bar"}'); // No skipValidation = false
				throw new Error('Expected error');
			} catch (err: unknown) {
				expect((err as Error).message).to.equal('Message missing required keys.');
			}
		});

		it('accepts array when skipping validation', async () => {
			const data = await sns.validatePayload([] as any, true); // Cast to any if validatePayload expects string | object
			expect(data).to.deep.equal([]);
		});

		it('accepts object when skipping validation', async () => {
			const data = await sns.validatePayload({}, true);
			expect(data).to.deep.equal({});
		});

		it('skipValidation skips SNS message validation and only parses', async () => {
			const data = await sns.validatePayload('{"foo":"bar"}', true);
			expect(data).to.deep.equal({foo: 'bar'});
		});
	});

	describe('#subscribe', () => {
		it('sends subscribe request', async () => {
			snsMock.on(SubscribeCommand).resolves({
				SubscriptionArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic:subscription-id'
			});

			await sns.subscribe(
				'arn:aws:sns:eu-west-1:111111111111:mytopic',
				'HTTP',
				'http://foobar.com'
			);

			expect(snsMock.calls()).length(1);
			const [subscribeCall] = snsMock.calls();
			expect(subscribeCall.args[0].input).to.deep.equal({
				TopicArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic',
				Protocol: 'HTTP',
				Endpoint: 'http://foobar.com'
			});
		});
	});

	describe('#setTopicAttributes', () => {
		it('sets topic attributes sequentially', async () => {
			snsMock.on(SetTopicAttributesCommand).resolves({});

			await sns.setTopicAttributes(
				'arn:aws:sns:eu-west-1:111111111111:mytopic',
				{
					DisplayName: 'My Topic',
					Policy: '{"Version":"2012-10-17"}'
				}
			);

			expect(snsMock.calls()).length(2);
			const calls = snsMock.calls();

			expect(calls[0].args[0].input).to.deep.equal({
				TopicArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic',
				AttributeName: 'DisplayName',
				AttributeValue: 'My Topic'
			});

			expect(calls[1].args[0].input).to.deep.equal({
				TopicArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic',
				AttributeName: 'Policy',
				AttributeValue: '{"Version":"2012-10-17"}'
			});
		});
	});

	describe('#findSubscriptionArn', () => {
		it('finds subscription arn', async () => {
			snsMock.on(ListSubscriptionsByTopicCommand).resolves({
				Subscriptions: [{
					SubscriptionArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic:subscription-id',
					Protocol: 'HTTP',
					Endpoint: 'http://foobar.com'
				}]
			});

			const arn = await sns.findSubscriptionArn(
				'arn:aws:sns:eu-west-1:111111111111:mytopic',
				'HTTP',
				'http://foobar.com'
			);

			expect(arn).to.equal('arn:aws:sns:eu-west-1:111111111111:mytopic:subscription-id');
			expect(snsMock.calls()).length(1);
			expect(snsMock.calls()[0].args[0].input).to.deep.equal({
				TopicArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic'
			});
		});

		it('handles pending confirmation', async () => {
			snsMock.on(ListSubscriptionsByTopicCommand).resolves({
				Subscriptions: [{
					SubscriptionArn: 'PendingConfirmation',
					Protocol: 'HTTP',
					Endpoint: 'http://foobar.com'
				}]
			});

			try {
				await sns.findSubscriptionArn(
					'arn:aws:sns:eu-west-1:111111111111:mytopic',
					'HTTP',
					'http://foobar.com'
				);
				throw new Error('Should have thrown');
			} catch (err: unknown) {
				expect(err instanceof SNSError).to.be.true;
				expect((err as SNSError).code).to.equal('PENDING');
				expect((err as SNSError).message).to.equal('Subscription is pending confirmation');
			}
		});

		it('handles pagination', async () => {
			snsMock
				.on(ListSubscriptionsByTopicCommand)
				.resolvesOnce({
					NextToken: 'next-token',
					Subscriptions: []
				})
				.resolvesOnce({
					Subscriptions: [{
						SubscriptionArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic:subscription-id',
						Protocol: 'HTTP',
						Endpoint: 'http://foobar.com'
					}]
				});

			const arn = await sns.findSubscriptionArn(
				'arn:aws:sns:eu-west-1:111111111111:mytopic',
				'HTTP',
				'http://foobar.com'
			);

			expect(arn).to.equal('arn:aws:sns:eu-west-1:111111111111:mytopic:subscription-id');
			expect(snsMock.calls()).length(2);
		});
	});

	describe('#setSubscriptionAttributes', () => {
		it('sets subscription attributes sequentially', async () => {
			snsMock.on(SetSubscriptionAttributesCommand).resolves({});

			await sns.setSubscriptionAttributes(
				'arn:aws:sns:eu-west-1:111111111111:mytopic:subscription-id',
				{
					RawMessageDelivery: 'true',
					FilterPolicy: '{"event":["order_placed"]}'
				}
			);

			expect(snsMock.calls()).length(2);
			const calls = snsMock.calls();

			expect(calls[0].args[0].input).to.deep.equal({
				SubscriptionArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic:subscription-id',
				AttributeName: 'RawMessageDelivery',
				AttributeValue: 'true'
			});

			expect(calls[1].args[0].input).to.deep.equal({
				SubscriptionArn: 'arn:aws:sns:eu-west-1:111111111111:mytopic:subscription-id',
				AttributeName: 'FilterPolicy',
				AttributeValue: '{"event":["order_placed"]}'
			});
		});
	});
});
