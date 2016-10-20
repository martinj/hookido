'use strict';

const Promise = require('bluebird');
const AWS = require('aws-sdk');
const MessageValidator = require('sns-validator');
const validator = new MessageValidator();

class SNS {

	constructor(topicArn, opts) {
		this.topicArn = topicArn;

		const sns = new AWS.SNS(opts || {});
		this.sns = {
			subscribe: Promise.promisify(sns.subscribe, {context: sns}),
			setTopicAttributes: Promise.promisify(sns.setTopicAttributes, {context: sns})
		};
	}

	setTopicAttributes(attributes) {
		// this needs to be done sequentially otherwise only one attribute will be set, have no idea why.
		return Promise.mapSeries(Object.keys(attributes), (key) => {
			return this.sns.setTopicAttributes({
				TopicArn: this.topicArn,
				AttributeName: key,
				AttributeValue: attributes[key]
			});
		});
	}

	subscribe(Protocol, Endpoint) {
		const params = {
			TopicArn: this.topicArn,
			Protocol,
			Endpoint
		};

		return this.sns.subscribe(params);
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

			validator.validate(data, (err, message) => {
				if (err) {
					return reject(err);
				}

				resolve(data);
			});
		});
	}
}

module.exports = SNS;
