'use strict';

const Joi = require('joi');
const Hoek = require('hoek');
const SNS = require('./lib/sns');
const handlers = require('./handlers');

const validOptions = Joi.object({
	topicArn: Joi.string().required(),
	skipPayloadValidation: Joi.boolean().default(false).optional().description('Skip Signature validation on SNS message'),
	subscribe: Joi.object({
		endpoint: Joi.string().required(),
		protocol: Joi.string().valid('HTTP', 'HTTPS').required(),
		attributes: Joi.object({}).optional().description('Set subscription attributes')
	}).optional().description('Automatically subscribe onPostStart'),
	topicAttributes: Joi.object().optional().description('Automatically sets topic attributes on onPostStart'),
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

	const sns = new SNS(opts.topicArn, opts.aws);
	server.expose('sns', sns);

	if (opts.subscribe) {
		server.ext('onPostStart', (srv, next) => {
			sns
				.subscribe(opts.subscribe.protocol, opts.subscribe.endpoint)
				.then(() => server.log(['hookido', 'subscribe'], 'Subscription request sent'))
				.catch((err) => server.log(['hookido', 'subscribe', 'error'], err));

			next();
		});
	}

	if (opts.topicAttributes) {
		server.ext('onPostStart', (srv, next) => {
			sns
				.setTopicAttributes(opts.topicAttributes)
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
			handler: handlers.hook(opts.handlers, opts.skipPayloadValidation)
		}
	}, opts.route || {}));

	next();
};

exports.register.attributes = {
	name: 'hookido'
};
