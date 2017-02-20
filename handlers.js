'use strict';

const Hoek = require('hoek');
const request = require('request-prom');

exports.hook = (sns, {handlers, skipPayloadValidation, topic}) => {
	handlers = Hoek.applyToDefaults({
		subscriptionconfirmation: confirmSubscription.bind(null, sns, topic)
	}, handlers);

	return (req, reply) => {
		sns
			.validatePayload(req.payload, skipPayloadValidation)
			.then(dispatchToHandler.bind(null, handlers, req, reply))
			.catch(reply);
	};
};

function dispatchToHandler(handlers, req, reply, payload) {
	const handler = handlers[payload.Type.toLowerCase()];

	if (!handler) {
		const msg = `Unable to handle message with type: ${payload.Type}`;
		req.log(['hookido', 'error'], msg);
		throw new Error(msg);
	}

	return handler(req, reply, payload);
}

function confirmSubscription(sns, topicOpts, req, reply, payload) {
	return request
		.get(payload.SubscribeURL)
		.then((res) => {
			req.log(['hookido', 'info'], `SNS subscription confirmed for ${payload.TopicArn}`);
			reply().code(200);

			const susbscriptionAttr = Hoek.reach(topicOpts, 'subscribe.attributes');
			if (susbscriptionAttr) {
				return sns
					.findSubscriptionArn(topicOpts.arn, topicOpts.subscribe.protocol, topicOpts.subscribe.endpoint)
					.then((arn) => sns.setSubscriptionAttributes(arn, susbscriptionAttr))
					.catch((err) => {
						req.log(['hookido', 'error'], `Unable to update subscription attributes for ${payload.TopicArn}, err: ${err.message}`);
					});
			}
		})
		.catch((err) => {
			req.log(['hookido', 'error'], `Unable to confirm SNS subscription for ${payload.TopicArn}, err: ${err.message}`);
			throw err;
		});
}
