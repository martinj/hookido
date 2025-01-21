'use strict';

const Hoek = require('@hapi/hoek');

exports.hook = (sns, {handlers, skipPayloadValidation, topic}) => {
	handlers = Hoek.applyToDefaults({
		subscriptionconfirmation: confirmSubscription.bind(null, sns, topic)
	}, handlers);

	return (req, h) => {
		return sns
			.validatePayload(req.payload, skipPayloadValidation)
			.then(dispatchToHandler.bind(null, handlers, req, h));
	};
};

function dispatchToHandler(handlers, req, h, payload) {
	const handler = handlers[payload.Type.toLowerCase()];

	if (!handler) {
		const msg = `Unable to handle message with type: ${payload.Type}`;
		req.log(['hookido', 'error'], msg);
		throw new Error(msg);
	}

	return handler(req, h, payload);
}

async function confirmSubscription(sns, topicOpts, req, h, payload) {
	const topicArn = Hoek.reach(topicOpts, 'arn');
	if (!topicArn) {
		return Promise.reject(new Error('Can\'t confirm subscription when no topic.arn is configured'));
	}

	if (payload.TopicArn !== topicArn) {
		const err = `Confirm subscription request for ${payload.TopicArn} doesn't match configured topic arn`;
		req.log(['hookido', 'error'], err);
		return Promise.reject(new Error(err));
	}

	try {
		await fetch(payload.SubscribeURL);
		req.log(['hookido', 'info'], `SNS subscription confirmed for ${payload.TopicArn}`);
	} catch (err) {
		req.log(['hookido', 'error'], `Unable to confirm SNS subscription for ${payload.TopicArn}, err: ${err.message}`);
		throw err;
	}

	const susbscriptionAttr = Hoek.reach(topicOpts, 'subscribe.attributes');
	if (susbscriptionAttr) {
		try {
			const arn = await sns.findSubscriptionArn(topicOpts.arn, topicOpts.subscribe.protocol, topicOpts.subscribe.endpoint);
			await sns.setSubscriptionAttributes(arn, susbscriptionAttr);
		} catch (err) {
			req.log(['hookido', 'error'], `Unable to update subscription attributes for ${payload.TopicArn}, err: ${err.message}`);
		}
	}

	return h.response().code(200);
}
