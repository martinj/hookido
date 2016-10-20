'use strict';

const Hoek = require('hoek');
const request = require('request-prom');

const handlerDefaults = {
	subscriptionconfirmation: confirmSubscription
};

exports.hook = (handlers, skipValidation) => {
	handlers = Hoek.applyToDefaults(handlerDefaults, handlers);

	return (req, reply) => {
		const sns = req.server.plugins.hookido.sns;

		sns
			.validatePayload(req.payload, skipValidation)
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

function confirmSubscription(req, reply, payload) {
	return request
		.get(payload.SubscribeURL)
		.then((res) => {
			req.log(['hookido', 'info'], 'SNS subscription confirmed');
			reply().code(200);
		})
		.catch((err) => {
			req.log(['hookido', 'error'], `Unable to confirm SNS subscription, err: ${err.message}`);
			throw err;
		});
}
