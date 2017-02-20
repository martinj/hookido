'use strict';

const Promise = require('bluebird');
const AWS = require('aws-sdk');
const MessageValidator = require('sns-validator');
const validator = new MessageValidator();

class SNS {

	constructor(awsConfig) {
		const sns = new AWS.SNS(awsConfig || {});
		this.sns = {
			subscribe: Promise.promisify(sns.subscribe, {context: sns}),
			setTopicAttributes: Promise.promisify(sns.setTopicAttributes, {context: sns}),
			listSubscriptionsByTopic: Promise.promisify(sns.listSubscriptionsByTopic, {context: sns}),
			setSubscriptionAttributes: Promise.promisify(sns.setSubscriptionAttributes, {context: sns})
		};
	}

	setTopicAttributes(TopicArn, attributes) {
		// this needs to be done sequentially otherwise only one attribute will be set, have no idea why.
		return Promise.mapSeries(Object.keys(attributes), (key) => {
			return this.sns.setTopicAttributes({
				TopicArn,
				AttributeName: key,
				AttributeValue: attributes[key]
			});
		});
	}

	subscribe(TopicArn, Protocol, Endpoint) {
		const params = {
			TopicArn,
			Protocol,
			Endpoint
		};

		return this.sns.subscribe(params);
	}

	setSubscriptionAttributes(SubscriptionArn, attributes) {
		return Promise.mapSeries(Object.keys(attributes), (key) => {
			return this.sns.setSubscriptionAttributes({
				SubscriptionArn,
				AttributeName: key,
				AttributeValue: attributes[key]
			});
		});
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

		return this.sns
			.listSubscriptionsByTopic(params)
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
