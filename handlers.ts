import Hoek from '@hapi/hoek';
import type {Request, ResponseToolkit, ResponseObject, Lifecycle} from '@hapi/hapi';
import type SNS from './lib/sns.js'; // Import SNS class type
import type {SNSMessage} from './lib/sns.js'; // Import SNSMessage interface

// Define interfaces for handler options
interface HandlerFunction {
	(req: Request, h: ResponseToolkit, payload: SNSMessage): Promise<ResponseObject> | ResponseObject | Promise<any> | any;
}

export interface PluginHandlers { // Exported
	subscriptionconfirmation?: HandlerFunction;
	notification: HandlerFunction;
	[key: string]: HandlerFunction | undefined; // Allow other string keys
}

interface TopicSubscriptionAttributes { // Not exported, used internally by TopicConfig
	[key: string]: string;
}

interface TopicSubscribeOptions { // Not exported, used internally by TopicConfig
	protocol: string;
	endpoint: string;
	attributes?: TopicSubscriptionAttributes;
}

export interface TopicConfig { // Exported
	arn: string;
	attributes?: Record<string, string>; // For SetTopicAttributes
	subscribe?: TopicSubscribeOptions;
}

import type {SNSClientConfig} from '@aws-sdk/client-sns';
import type {RouteOptions} from '@hapi/hapi';

export interface HookOptions {
	handlers: PluginHandlers;
	skipPayloadValidation?: boolean;
	topic?: TopicConfig; // Making topic optional as it might not be needed for all use cases
	aws?: SNSClientConfig; // Added for compatibility with index.ts
	route?: Partial<RouteOptions>; // Added for compatibility with index.ts, using Partial
}


export const hook = (snsInstance: SNS, {handlers: pluginHandlers, skipPayloadValidation, topic: topicConfig}: HookOptions): Lifecycle.Method => {
	const activeHandlers = Hoek.applyToDefaults({
		subscriptionconfirmation: confirmSubscription.bind(null, snsInstance, topicConfig)
	}, pluginHandlers) as PluginHandlers;

	return async (req: Request, h: ResponseToolkit): Promise<ResponseObject | Error> => {
		try {
			const payload = await snsInstance.validatePayload(req.payload as (string | Record<string, any>), skipPayloadValidation);
			return dispatchToHandler(activeHandlers, req, h, payload);
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error during payload validation or dispatch';
			req.log(['hookido', 'error'], errorMessage);
			// Consider returning a Boom error object for Hapi-specific error handling
			return h.response({error: 'Internal Server Error', message: errorMessage}).code(500);
		}
	};
};

function dispatchToHandler(
	activeHandlers: PluginHandlers,
	req: Request,
	h: ResponseToolkit,
	payload: SNSMessage
): Promise<ResponseObject> | ResponseObject {
	const handlerKey = payload.Type.toLowerCase();
	const handler = activeHandlers[handlerKey];

	if (!handler) {
		const msg = `Unable to handle message with type: ${payload.Type}`;
		req.log(['hookido', 'error'], msg);
		throw new Error(msg); // This will be caught by the outer try/catch in the main hook function
	}

	return handler(req, h, payload);
}

async function confirmSubscription(
	snsInstance: SNS,
	topicConfig: TopicConfig | undefined,
	req: Request,
	h: ResponseToolkit,
	payload: SNSMessage
): Promise<ResponseObject> {
	// Ensure topicConfig and topicConfig.arn are defined before using them
	if (!topicConfig || !topicConfig.arn) {
		const errMsg = 'Cannot confirm subscription: topic ARN is not configured.';
		req.log(['hookido', 'error'], errMsg);
		throw new Error(errMsg);
	}

	if (payload.TopicArn !== topicConfig.arn) {
		const err = `Confirm subscription request for ${payload.TopicArn} doesn't match configured topic arn ${topicConfig.arn}`;
		req.log(['hookido', 'error'], err);
		throw new Error(err);
	}

	if (!payload.SubscribeURL) {
		const errMsg = `SubscriptionConfirmation message for topic ${payload.TopicArn} is missing the SubscribeURL.`;
		req.log(['hookido', 'error'], errMsg);
		throw new Error(errMsg);
	}

	try {
		await fetch(payload.SubscribeURL);
		req.log(['hookido', 'info'], `SNS subscription confirmed for ${payload.TopicArn}`);
	} catch (err) {
		const fetchError = err instanceof Error ? err.message : String(err);
		req.log(['hookido', 'error'], `Unable to confirm SNS subscription for ${payload.TopicArn}, fetch error: ${fetchError}`);
		throw err; // Rethrow to be caught by the main hook's error handler
	}

	const subscriptionAttributes = Hoek.reach(topicConfig, 'subscribe.attributes');
	const subscribeProtocol = Hoek.reach(topicConfig, 'subscribe.protocol');
	const subscribeEndpoint = Hoek.reach(topicConfig, 'subscribe.endpoint');

	if (subscriptionAttributes && subscribeProtocol && subscribeEndpoint) {
		try {
			// Ensure findSubscriptionArn is called with defined protocol and endpoint.
			// The types for topicConfig.subscribe should ensure this if properly defined.
			const arn = await snsInstance.findSubscriptionArn(topicConfig.arn, subscribeProtocol, subscribeEndpoint);
			if (arn) {
				await snsInstance.setSubscriptionAttributes(arn, subscriptionAttributes);
				req.log(['hookido', 'info'], `Successfully set subscription attributes for ${arn}`);
			} else {
				req.log(['hookido', 'warn'], `Could not find subscription ARN for ${topicConfig.arn} to set attributes.`);
			}
		} catch (err) {
			const attrError = err instanceof Error ? err.message : String(err);
			req.log(['hookido', 'error'], `Unable to update subscription attributes for ${payload.TopicArn}, err: ${attrError}`);
			// Optionally rethrow or handle; for now, just logging
		}
	}

	return h.response().code(200);
}
