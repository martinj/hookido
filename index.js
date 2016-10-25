'use strict';

const Joi = require('joi');
const Hoek = require('hoek');
const SNS = require('./lib/sns');
const handlers = require('./handlers');

const validOptions = Joi.object({
	topic: Joi.object({
		arn: Joi.string().required(),
		attributes: Joi.object().optional().description('Automatically sets topic attributes on onPostStart'),
		subscribe: Joi.object({
			endpoint: Joi.string().required(),
			protocol: Joi.string().valid('HTTP', 'HTTPS').required(),
			attributes: Joi.object().optional().description('Set subscription attributes, only used if the plugin handles the subscription confirmation and subscription does not exist')
		}).optional().description('Automatically subscribe if subscription does not exit on onPostStart')
	}).optional(),
	skipPayloadValidation: Joi.boolean().default(false).optional().description('Skip Signature validation on SNS message'),
	aws: Joi.object().optional().description('AWS config used for SNS'),
	route: Joi.object().optional().description('Overrides for the default route configuration'),
	handlers: Joi.object({
		subscriptionconfirmation: Joi.func().optional().description('If omitted the plugin will handle the subscription confirmation'),
		notification: Joi.func().required()
	}).required().description('Request handler functions for different kind of sns messages')
});

exports.register = function (server, opts, next) {
	const results = Joi.validate(opts, validOptions);
	Hoek.assert(!results.error, results.error);

	const sns = new SNS(opts.aws);
	server.expose('sns', sns);

	const subscribe = Hoek.reach(opts, 'topic.subscribe');

	function requestSubscription() {
		return sns
			.subscribe(opts.topic.arn, subscribe.protocol, subscribe.endpoint)
			.then(() => server.log(['hookido', 'subscribe'], 'Subscription request sent'));
	}

	if (subscribe) {

		server.ext('onPostStart', (srv, next) => {
			sns
				.findSubscriptionArn(opts.topic.arn, subscribe.protocol, subscribe.endpoint)
				.then(() => server.log(['hookido', 'subscribe'], 'Subscription already exists'))
				.catch({code: 'NOT_FOUND'}, requestSubscription)
				.catch({code: 'PENDING'}, requestSubscription)
				.catch((err) => server.log(['hookido', 'subscribe', 'error'], err));

			next();
		});

	}

	const topicAttributes = Hoek.reach(opts, 'topic.attributes');
	if (topicAttributes) {
		server.ext('onPostStart', (srv, next) => {
			sns
				.setTopicAttributes(opts.topic.arn, topicAttributes)
				.then(() => server.log(['hookido', 'setTopicAttributes'], 'topicAttributes was updated'))
				.catch((err) => server.log(['hookido', 'setTopicAttributes', 'error'], err));

			next();
		});
	}

	server.route(Hoek.applyToDefaults({
		method: 'POST',
		path: '/hookido',
		config: {
			auth: false,
			description: 'SNS webhook endpoint',
			handler: handlers.hook(opts)
		}
	}, opts.route || {}));

	next();
};

exports.register.attributes = {
	name: 'hookido'
};
