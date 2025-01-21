'use strict';

const {mockClient} = require('aws-sdk-client-mock');
const {
	SNSClient,
	SubscribeCommand,
	SetTopicAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SetSubscriptionAttributesCommand
} = require('@aws-sdk/client-sns');
const SNS = require('../../lib/sns');
const {expect} = require('chai');

describe('SNS', () => {
	let sns;
	let snsMock;

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
			} catch (err) {
				expect(err.message).to.match(/Invalid SNS payload: Unexpected token/);
			}
		});

		it('rejects on null payload', async () => {
			try {
				await sns.validatePayload(null);
				throw new Error('Expected error');
			} catch (err) {
				expect(err.message).to.equal('Invalid SNS payload: Not valid JSON');
			}
		});

		it('rejects on invalid payload', async () => {
			try {
				await sns.validatePayload('{"foo":"bar"}');
				throw new Error('Expected error');
			} catch (err) {
				expect(err.message).to.equal('Message missing required keys.');
			}
		});

		it('accepts array', async () => {
			const data = await sns.validatePayload([], true);
			expect(data).to.deep.equal([]);
		});

		it('accepts object', async () => {
			const data = await sns.validatePayload({}, true);
			expect(data).to.deep.equal({});
		});

		it('skipValidation skips SNS message validation only parses', async () => {
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
			} catch (err) {
				expect(err.code).to.equal('PENDING');
				expect(err.message).to.equal('Subscription is pending confirmation');
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
