'use strict';

const {
	SNSClient,
	SubscribeCommand,
	SetTopicAttributesCommand,
	ListSubscriptionsByTopicCommand,
	SetSubscriptionAttributesCommand
} = require('@aws-sdk/client-sns');
const MessageValidator = require('sns-validator');
const validator = new MessageValidator();

class SNS {

	constructor(awsConfig) {
		this.snsClient = new SNSClient(awsConfig || {});
	}

	async setTopicAttributes(TopicArn, attributes) {
		// Process attributes sequentially
		for (const key of Object.keys(attributes)) {
			const command = new SetTopicAttributesCommand({
				TopicArn,
				AttributeName: key,
				AttributeValue: attributes[key]
			});
			await this.snsClient.send(command);
		}
	}

	subscribe(TopicArn, Protocol, Endpoint) {
		const command = new SubscribeCommand({
			TopicArn,
			Protocol,
			Endpoint
		});

		return this.snsClient.send(command);
	}

	async setSubscriptionAttributes(SubscriptionArn, attributes) {
		for (const key of Object.keys(attributes)) {
			const command = new SetSubscriptionAttributesCommand({
				SubscriptionArn,
				AttributeName: key,
				AttributeValue: attributes[key]
			});
			await this.snsClient.send(command);
		}
	}

	/**
	 * Find subscription arn
	 * @param  {String} TopicArn
	 * @param  {String} Protocol
	 * @param  {String} Endpoint
	 * @param  {String} [NextToken] used for paged results
	 * @return {Promise} resolves with arn, rejects with Error using err.code = 'NOT_FOUND' if it doesnt find the scription
	 */
	findSubscriptionArn(TopicArn, Protocol, Endpoint, NextToken) {
		const params = {TopicArn};

		if (NextToken) {
			params.NextToken = NextToken;
		}

		const command = new ListSubscriptionsByTopicCommand(params);

		return this.snsClient
			.send(command)
			.then((data) => {
				const arn = data.Subscriptions.find((sub) => {
					return sub.Protocol.toLowerCase() === Protocol.toLowerCase() &&
						sub.Endpoint.toLowerCase() === Endpoint.toLowerCase();
				});

				if (arn) {
					if (arn.SubscriptionArn === 'PendingConfirmation') {
						const err = new Error('Subscription is pending confirmation');
						err.code = 'PENDING';
						throw err;
					}

					return arn.SubscriptionArn;
				}

				if (data.NextToken) {
					return this.findSubscriptionArn(TopicArn, Protocol, Endpoint, data.NextToken);
				} else {
					const err = new Error(`Couldn't find subscription arn for ${Endpoint} on topic: ${TopicArn}`);
					err.code = 'NOT_FOUND';
					throw err;
				}
			});
	}

	/**
	 * Validate and parse SNS request payload
	 * @param  {String} payload
	 * @param  {Boolean} [skipValidation] if true skip AWS signature validation and only do parsing.
	 * @return {Promise} resolves with parsed json
	 */
	validatePayload(payload, skipValidation) {
		return new Promise((resolve, reject) => {
			let data;

			if (typeof (payload) === 'object' && payload !== null && payload !== undefined) {
				data = payload;
			} else {

				try {
					data = JSON.parse(payload);
					if (!data) {
						return reject(new Error('Invalid SNS payload: Not valid JSON'));
					}
				} catch (e) {
					return reject(new Error(`Invalid SNS payload: ${e.message}`));
				}

			}

			if (skipValidation) {
				return resolve(data);
			}

			validator.validate(data, (err) => {
				if (err) {
					return reject(err);
				}

				resolve(data);
			});
		});
	}
}

module.exports = SNS;
