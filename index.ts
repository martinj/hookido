import Joi from 'joi';
import type {ObjectSchema, ArraySchema, AlternativesSchema} from 'joi'; // Corrected Joi type imports
import Hoek from '@hapi/hoek';
import type {Server, Plugin, RouteOptions, ServerRoute} from '@hapi/hapi';
import SNS from './lib/sns.js';
import type {SNSClientConfig} from '@aws-sdk/client-sns';
import {hook as webhookHandler} from './handlers.js';
// Import HookOptions from handlers.js, this is what webhookHandler expects
import type {HookOptions as HandlersHookOptions, TopicConfig as HandlersTopicConfig, PluginHandlers} from './handlers.js';

// Define the comprehensive options structure used within this index.ts file
// This includes 'aws' and 'route' which are part of the Joi schema here.
interface InternalSingleHookOptions {
	topic?: HandlersTopicConfig; // Re-use TopicConfig from handlers
	skipPayloadValidation?: boolean;
	aws?: SNSClientConfig;
	route?: Partial<RouteOptions>; // RouteOptions can be complex, so Partial is safer
	handlers: PluginHandlers; // Re-use PluginHandlers from handlers
}

// Joi schema for individual hook configuration, mapping to InternalSingleHookOptions
const singleOptionInternalSchema: ObjectSchema<InternalSingleHookOptions> = Joi.object({
	topic: Joi.object({
		arn: Joi.string().required(),
		attributes: Joi.object().pattern(Joi.string(), Joi.string()).optional().description('Automatically sets topic attributes on onPostStart'),
		subscribe: Joi.object({
			endpoint: Joi.string().uri({scheme: ['http', 'https']}).required(),
			protocol: Joi.string().valid('http', 'https').insensitive().required(),
			attributes: Joi.object().pattern(Joi.string(), Joi.string()).optional().description('Set subscription attributes')
		}).optional()
	}).optional(),
	skipPayloadValidation: Joi.boolean().default(false).optional(),
	aws: Joi.object().unknown(true).optional().description('AWS config used for SNS'), // Allow any object for aws
	route: Joi.object().unknown(true).optional().description('Overrides for the default route configuration'), // Allow any object for route
	handlers: Joi.object({
		subscriptionconfirmation: Joi.func().optional(),
		notification: Joi.func().required()
	}).required()
});

// Joi schema for plugin options (array or single object)
const validOptionsSchema: AlternativesSchema = Joi.alternatives().try(
	Joi.array().items(singleOptionInternalSchema),
	singleOptionInternalSchema
);


// The type for the options that the plugin's register function will receive
type PluginRegistrationOptions = InternalSingleHookOptions | InternalSingleHookOptions[];

function register(server: Server, opts: PluginRegistrationOptions): void {
	const validationResult = validOptionsSchema.validate(opts);
	if (validationResult.error) {
		throw validationResult.error;
	}
	// After validation, opts conforms to InternalSingleHookOptions | InternalSingleHookOptions[]
	const validatedOpts = validationResult.value as PluginRegistrationOptions;


	// server.plugins.hookido is now typed via hapi-augmentation.d.ts
	if (!server.plugins.hookido) {
		server.plugins.hookido = {snsInstances: []};
	}
	// No need to cast pluginData if augmentation is working
	const pluginSnsInstances = server.plugins.hookido.snsInstances;

	const configurations: InternalSingleHookOptions[] = Array.isArray(validatedOpts) ? validatedOpts : [validatedOpts];

	configurations.forEach((config) => init(server, config, pluginSnsInstances));
	server.expose('snsInstances', pluginSnsInstances);
}

function init(server: Server, config: InternalSingleHookOptions, snsInstances: SNS[]): void {
	const sns = new SNS(config.aws); // config.aws is SNSClientConfig | undefined
	snsInstances.push(sns);

	const topicConfig = config.topic;

	if (topicConfig && topicConfig.subscribe) {
		const {arn: topicArn, subscribe: subscribeOpts} = topicConfig;
		if (topicArn && subscribeOpts && subscribeOpts.endpoint && subscribeOpts.protocol) {
			server.ext('onPostStart', async () => {
				try {
					// Assuming findSubscriptionArn is correctly typed in SNS class
					await sns.findSubscriptionArn(topicArn, subscribeOpts.protocol, subscribeOpts.endpoint);
					server.log(['hookido', 'subscribe'], `Subscription already exists for ${topicArn}`);
				} catch (err: unknown) {
					const errorCode = (err && typeof err === 'object' && 'code' in err) ? (err as { code: string }).code : undefined;
					if (errorCode === 'NOT_FOUND' || errorCode === 'PENDING') {
						try {
							await sns.subscribe(topicArn, subscribeOpts.protocol, subscribeOpts.endpoint);
							server.log(['hookido', 'subscribe'], `Subscription request sent for ${topicArn}`);
						} catch (subscribeErr: unknown) {
							const message = subscribeErr instanceof Error ? subscribeErr.message : String(subscribeErr);
							server.log(['hookido', 'subscribe', 'error'], message);
						}
					} else {
						const message = err instanceof Error ? err.message : String(err);
						server.log(['hookido', 'subscribe', 'error'], message);
					}
				}
			});
		}
	}

	if (topicConfig && topicConfig.attributes && topicConfig.arn) {
		const {arn: topicArn, attributes: topicAttributes} = topicConfig;
		server.ext('onPostStart', async () => {
			try {
				await sns.setTopicAttributes(topicArn, topicAttributes);
				server.log(['hookido', 'setTopicAttributes'], `topicAttributes was updated for ${topicArn}`);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				server.log(['hookido', 'setTopicAttributes', 'error'], message);
			}
		});
	}

	const routeDefaults: ServerRoute = {
		method: 'POST',
		path: '/hookido',
		options: {
			auth: false,
			description: 'SNS webhook endpoint',
			// Pass config as HandlersHookOptions. This assumes InternalSingleHookOptions is compatible.
			// A specific mapping or ensuring HandlersHookOptions includes aws/route might be needed.
			handler: webhookHandler(sns, config as HandlersHookOptions)
		}
	};

	// Cast config.route to Partial<RouteOptions> for Hoek.applyToDefaults
	const finalRoute = Hoek.applyToDefaults(routeDefaults, config.route as Partial<RouteOptions> || {}) as ServerRoute;
	server.route(finalRoute);
}

export const plugin: Plugin<PluginRegistrationOptions> = {
	name: 'hookido',
	register,
	multiple: true,
	requirements: {
		hapi: '>=20.0.0'
	}
};

export default plugin;
